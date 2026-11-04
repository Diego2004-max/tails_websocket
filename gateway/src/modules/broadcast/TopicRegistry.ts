/**
 * topic -> Set<connection>.
 *  add / remove: O(1) average. Iterate a topic: O(subscribers of that topic),
 *  independent of the total number of connections on the instance (RF-5).
 */
export class TopicRegistry<C> {
  private readonly map = new Map<string, Set<C>>();

  /** @returns true when this was the first local subscriber of the topic. */
  add(topic: string, conn: C): boolean {
    let set = this.map.get(topic);
    const first = !set;
    if (!set) {
      set = new Set();
      this.map.set(topic, set);
    }
    set.add(conn);
    return first;
  }

  /** @returns true when this was the last local subscriber of the topic. */
  remove(topic: string, conn: C): boolean {
    const set = this.map.get(topic);
    if (!set) return false;
    set.delete(conn);
    if (set.size === 0) {
      this.map.delete(topic);
      return true;
    }
    return false;
  }

  get(topic: string): ReadonlySet<C> | undefined {
    return this.map.get(topic);
  }
  topics(): IterableIterator<string> {
    return this.map.keys();
  }
  all(): IterableIterator<Set<C>> {
    return this.map.values();
  }
}
