// Document ids that callers send (bookId, chapterId…) end up in Firestore
// paths such as users/{uid}/books/{bookId}: they must be a single path
// segment of safe characters, never text that could add segments («a/b»), so
// no caller can steer a path. The app's ids are Firestore auto-ids or fixed
// ids like «sample-1», well inside this.

import { z } from 'zod';

export const docIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
