# PDF Chat UI – Change journey (why and what)

This doc explains **why** certain changes were made to the PDF chat UI and **what** to look for in the code. It’s meant to help you understand the flow and decisions so you can upskill when reading or extending AI-generated code.

---

## 1. One place for “what the user sees” from the API

**What:** A small helper (e.g. `getApiMessage`) takes the raw API response and returns a single string to show in the chat.

**Why:** The backend can return different shapes:

- Plain string: e.g. `"Email not found"`
- Object with `message`: e.g. `{ message: "Not found in document." }`
- Object with `error` (and maybe `details`): e.g. `{ error: "Service temporarily unavailable", details: "..." }`
- HTTP 429 for rate limit

If we didn’t normalize this, the UI would have to handle each shape in multiple places and could show raw technical errors (e.g. rate limit text) as if the “AI” said them.

**What to look for in code:** One function that checks `typeof data === 'string'`, then `data.message`, then `data.error` / `data.details`, and for 429 returns a short, user-friendly line like “Too many requests. Please wait a moment and try again.”

---

## 2. Rate limit (429) → friendly message, not raw error

**What:** When the API returns status 429 (rate limit), we don’t show the API’s error body in the chat. We show a fixed, friendly message.

**Why:** Rate limit responses often contain internal or technical wording. Showing that in the assistant bubble looks like the AI is saying an error message. By mapping 429 to a single, clear sentence we keep the chat readable and consistent.

**What to look for in code:** `getApiMessage` (or equivalent) receives the response status; if `status === 429` it returns the friendly string and does not use the response body for the chat text.

---

## 3. Stable IDs for list items (e.g. `crypto.randomUUID()`)

**What:** Each chat message has a unique `id` (e.g. from `crypto.randomUUID()`), and the list uses `key={msg.id}`.

**Why:** React uses `key` to match list items across re-renders. If we used the index as key, adding a new message at the end would still work, but reordering or inserting in the middle could cause wrong DOM reuse and bugs (e.g. wrong message content, focus, or animation). A stable, unique id per message avoids that.

**Is `crypto.randomUUID()` safe?** Yes in modern browsers and Node. It’s part of the Web Crypto API and is suitable for non-security IDs (like React keys). Use it when you need a unique id for a list item or temporary object and don’t have an id from the server.

**What to look for in code:** Message objects have an `id` field set once when the message is created; the list renders with `key={msg.id}`.

---

## 4. Scrolling after the new message is on screen (`requestAnimationFrame`)

**What:** “Scroll to bottom” is run inside `requestAnimationFrame` (rAF).

**Why:** We want to scroll *after* React has painted the new message. If we scroll immediately after `setMessages(...)`, the DOM might not have updated yet, so the scroll height could be from the previous state and we’d miss the latest message. rAF runs right before the next paint, so the state update has been committed and we scroll with the correct height.

**When to use `requestAnimationFrame`:** Use it when you need to run something (layout read, scroll, measure) *after* the browser has (or is about to) update the DOM, e.g. after a React state update that changes the list. Avoid using it for heavy logic; keep it for things that depend on the updated layout.

**What to look for in code:** A `scrollToBottom` (or similar) function that wraps `scrollRef.current?.scrollTo(...)` in `requestAnimationFrame(...)`.

---

## 5. Encoding query params (`encodeURIComponent`)

**What:** When building the `/ask` URL we use `encodeURIComponent(email)` and `encodeURIComponent(query)` for the query parameters.

**Why:** Email and query can contain characters that are special in URLs:

- Email: `@`, `+`, `.`, etc.
- Query: spaces, `?`, `&`, `=`, `#`, etc.

If we put them in the URL as plain text, the server may parse the URL incorrectly (e.g. `user+tag@gmail.com` or “what is 2+2?” could break). Encoding turns them into a single safe string per parameter so the server receives the exact value.

**What to look for in code:** The URL is built with template literals and `encodeURIComponent(...)` around `email` and `query` in the query string.

---

## 6. Single place to scroll and refocus (`finally`)

**What:** We call “scroll to bottom” and “focus the input” in a `finally` block, and we only scroll once there (not in both `try` and `catch`).

**Why:** Both success and error paths add a new message and need the same follow-up: scroll so the new message is visible, and put focus back in the input so the user can type the next question without clicking. Doing this in `finally` avoids duplicating the same two calls and keeps behavior consistent even if we add more branches later.

**What to look for in code:** A `finally` block that runs `setIsLoading(false)`, then the scroll helper, then something like `setTimeout(() => inputRef.current?.focus(), 0)` (or similar) so focus runs after React re-enables the input.

---

## 7. Restoring focus after send

**What:** After the request finishes we call `inputRef.current?.focus()` (often inside a short `setTimeout(..., 0)`).

**Why:** Submitting the form clears the input and can move focus to the submit button or elsewhere, so the user would have to click back into the input to type again. Restoring focus keeps the flow smooth: send → answer appears → user can type immediately.

**Why `setTimeout(..., 0)`?** During `finally`, the input might still be disabled (`isLoading` was just set to false). React will re-render and re-enable it shortly after. Deferring focus by one tick (e.g. `setTimeout(..., 0)`) runs after the current synchronous work and the next React update, so the input is focusable when we call `focus()`.

**What to look for in code:** In the same `finally` (or right after it), a deferred call that runs `inputRef.current?.focus()`.

---

## 8. Not mutating state (functional updates)

**What:** When adding a message we use the form `setMessages((prev) => [...prev, newMessage])` instead of `messages.push(...); setMessages([...messages])`.

**Why:** React state updates are asynchronous. If we push into `messages` and then call `setMessages([...messages])`, we’re reading `messages` from the closure, which might be stale (e.g. from a previous render). The functional form `(prev) => [...prev, newMessage]` always gets the latest state and avoids subtle bugs where a new message doesn’t appear or overwrites another.

**What to look for in code:** Every `setMessages` that adds or updates messages uses the callback form `setMessages(prev => ...)` and does not read `messages` from the outer scope for that update.

---

## Quick reference

| Topic              | Where in code / idea                                      |
|--------------------|-----------------------------------------------------------|
| API → one string   | `getApiMessage(data, status)` (or equivalent)             |
| Rate limit 429     | Same helper, special case for `status === 429`           |
| List keys          | `key={msg.id}` and `id: crypto.randomUUID()` on messages |
| Scroll timing      | `requestAnimationFrame` around scroll logic               |
| URL safety         | `encodeURIComponent(email)` and `encodeURIComponent(query)` |
| Scroll + focus     | Both in `finally`; focus deferred with `setTimeout(..., 0)` |
| State updates      | `setMessages(prev => [...prev, newMessage])`              |
