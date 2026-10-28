# CopyQuick workspace instructions

- Use Node.js `v24.20.0` for every Node and npm command. Confirm with `node --version` before installing dependencies, running scripts, or validating changes.
- On this Apple Silicon workspace, prepend `/opt/homebrew/opt/node@24/bin` to `PATH` when the active shell does not already resolve Node `v24.20.0`.
- Do not bypass the exact Node version declared by `.node-version`, `.nvmrc`, `package.json`, and `.npmrc`.
- Use only disposable, fail-closed test storage. Never point tests or fixtures at production storage.
- Do not deploy, run production migrations, consume credits, or call real providers unless the user explicitly authorizes that action.
