import type { ChatPost } from "../../../shared/protocol";
import { createStore } from "./createStore";

type ScopedPost = ChatPost & { endpoint: string };
export const chatPosts = createStore<readonly ScopedPost[]>([]);

export function receiveChatPost(post: ChatPost, endpoint: string): void {
  chatPosts.set(items => items.some(item => item.id === post.id && item.endpoint === endpoint)
    ? items : [...items, { ...post, endpoint }].slice(-50));
}
