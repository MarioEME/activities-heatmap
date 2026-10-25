// Keys and other per-deployment settings live here, and ONLY here.
//
// DROPBOX_APP_KEY: the "App key" of your own Dropbox app
// (https://www.dropbox.com/developers/apps → Settings). It is NOT a secret:
// login uses OAuth 2.0 PKCE, so there is no client secret anywhere, and the
// key ends up in the built JavaScript anyway. Leave 'REPLACE_ME' to run the
// app without Dropbox (everything then stays in the browser session).
export const DROPBOX_APP_KEY = 'REPLACE_ME'
