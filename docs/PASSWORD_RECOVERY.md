# Password recovery

Email/password and Google-created accounts can request a password reset from
the login page. The public response is identical whether or not the account
exists. Requests are bounded per client IP.

Reset links expire after one hour. Tokens contain only an internal user ID,
expiry, and random nonce; they are authenticated with an HMAC key bound to the
current credential. Raw tokens are never stored or logged. Changing the
password immediately invalidates every link issued against the old credential.

A successful reset updates the password and revokes every stored session for
that user in one SQLite transaction. The reset request's own session is then
destroyed before rendering success, preventing session middleware from
recreating it. The user must log in again.

Delivery uses the bounded transactional email retry path and the configured
`PUBLIC_APP_ORIGIN`. Provider failures remain sanitized and never reveal account
existence.
