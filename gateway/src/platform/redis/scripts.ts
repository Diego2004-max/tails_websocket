/**
 * Lua scripts. Redis runs a script as a single, uninterruptible command:
 * no other client can observe or interleave between its steps. That is what makes
 * "idempotency + revert old version + 4 aggregate levels + history + publish"
 * one atomic operation (RF-1, RF-2, RF-3).
 *
 * Restrictions we accept: scripts must be deterministic, must declare every key
 * they touch in KEYS (cluster-safe), and must stay short because they block Redis.
 */

export const APPLY_SHEET = `
-- KEYS: 1 idem, 2 sheet, 3 tbl, 4 pst, 5 mun, 6 dept, 7 rankPst, 8 rankMun, 9 rankDept,
--       10 events, 11 lastId, 12 queue
-- ARGV: 1 version, 2 votesJson, 3 flagged(0/1), 4 voters, 5 table, 6 station, 7 municipality,
--       8 nowMs, 9 idemTtl, 10 sheetId, 11 priority, 12 streamMaxLen,
--       13 chDept, 14 chMun, 15 chPst, 16 chQueue, 17 jurorId

-- 1) Idempotency: a retry gets the ORIGINAL answer, never a silent drop.
local previous = redis.call('GET', KEYS[1])
if previous then
  local p = cjson.decode(previous)
  p.status = 'DUPLICATE'
  return cjson.encode(p)
end

local version = tonumber(ARGV[1])
local flagged = ARGV[3] == '1'
local voters = tonumber(ARGV[4])
local newVotes = cjson.decode(ARGV[2])
local fields = {'C1','C2','C3','BLANK','NULL','UNMARKED'}
local candidates = {'C1','C2','C3'}

-- 2) Convergence: only a strictly newer version of the same sheet changes state.
local stored = redis.call('HMGET', KEYS[2], 'version', 'applied', 'votes', 'voters')
local storedVersion = tonumber(stored[1]) or 0
if version <= storedVersion then
  local res = cjson.encode({status = 'STALE', version = storedVersion})
  redis.call('SET', KEYS[1], res, 'EX', ARGV[9])
  return res
end

local wasApplied = stored[2] == '1'
local applied = not flagged
local oldVotes = {}
local oldVoters = 0
if wasApplied then
  oldVotes = cjson.decode(stored[3])
  oldVoters = tonumber(stored[4]) or 0
end

redis.call('HSET', KEYS[2],
  'version', version, 'applied', applied and '1' or '0', 'votes', ARGV[2], 'voters', ARGV[4],
  'table', ARGV[5], 'station', ARGV[6], 'municipality', ARGV[7], 'juror', ARGV[17], 'updatedAt', ARGV[8])

-- 3) Delta = (new version, if counted) - (previous version, if it was counted).
if applied or wasApplied then
  local delta = {}
  for _, f in ipairs(fields) do
    delta[f] = (applied and (newVotes[f] or 0) or 0) - (wasApplied and (oldVotes[f] or 0) or 0)
  end
  delta.voters = (applied and voters or 0) - oldVoters
  delta.tables = (applied and 1 or 0) - (wasApplied and 1 or 0)

  local aggKeys = {KEYS[3], KEYS[4], KEYS[5], KEYS[6]}
  for _, key in ipairs(aggKeys) do
    for _, f in ipairs(fields) do
      if delta[f] ~= 0 then redis.call('HINCRBY', key, f, delta[f]) end
    end
    redis.call('HINCRBY', key, 'voters', delta.voters)
    redis.call('HINCRBY', key, 'tables', delta.tables)
  end
  local rankKeys = {KEYS[7], KEYS[8], KEYS[9]}
  for _, key in ipairs(rankKeys) do
    for _, c in ipairs(candidates) do
      if delta[c] ~= 0 then redis.call('ZINCRBY', key, delta[c], c) end
    end
  end

  -- 4) History for recovery (RF-6) + live notification, in the same atomic step.
  local ev = {
    sheetId = ARGV[10], table = tonumber(ARGV[5]), station = tonumber(ARGV[6]),
    municipality = tonumber(ARGV[7]), version = version, correction = storedVersion > 0,
    delta = delta, at = tonumber(ARGV[8])
  }
  local id = redis.call('XADD', KEYS[10], 'MAXLEN', '~', ARGV[12], '*', 'e', cjson.encode(ev))
  redis.call('EXPIRE', KEYS[10], 43200)
  redis.call('SET', KEYS[11], id)
  ev.id = id
  local payload = cjson.encode(ev)
  redis.call('PUBLISH', ARGV[13], payload)
  redis.call('PUBLISH', ARGV[14], payload)
  redis.call('PUBLISH', ARGV[15], payload)
end

-- 5) Verification queue (flagged sheets are registered but not counted).
if flagged then
  redis.call('ZADD', KEYS[12], tonumber(ARGV[11]), ARGV[10])
  redis.call('PUBLISH', ARGV[16], cjson.encode({type = 'queue_changed'}))
else
  if redis.call('ZREM', KEYS[12], ARGV[10]) == 1 then
    redis.call('PUBLISH', ARGV[16], cjson.encode({type = 'queue_changed'}))
  end
end

local status = flagged and 'FLAGGED' or 'ACCEPTED'
local result = cjson.encode({status = status, version = version})
redis.call('SET', KEYS[1], result, 'EX', ARGV[9])
return result
`;

/** Aggregate + ranking + last stream id read atomically, so snapshot and id agree. */
export const READ_SNAPSHOT = `
-- KEYS: 1 agg hash, 2 rank zset, 3 lastId
local lastId = redis.call('GET', KEYS[3])
if not lastId then lastId = '0-0' end
return {
  redis.call('HGETALL', KEYS[1]),
  redis.call('ZREVRANGE', KEYS[2], 0, -1, 'WITHSCORES'),
  lastId
}
`;

/** Renew only if we still own the lock (token compare-and-extend). */
export const RENEW_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

/** Release only if we still own the lock (token compare-and-delete). */
export const RELEASE_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
