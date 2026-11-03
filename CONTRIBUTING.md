# Contributing to RuDeFi

Thanks for helping improve RuDeFi. Reports and pull requests are welcome in English or Russian.

RuDeFi currently focuses on the onchain side of P2P workflows: wallets, portfolio visibility, address-risk signals, swaps, bridges, and token approvals. Discuss large changes before implementing them, especially anything involving custody, trade records, external data sharing, or new wallet permissions.

## Report a bug

Use the bug-report template and include:

- What you expected and what happened.
- Reproduction steps and the relevant commit, if known.
- Browser, operating system, wallet version, and network.
- A redacted screenshot or a short error message when useful.

Do not share a recovery phrase, private key, API key, authenticated request URL, or personal counterparty information. A wallet address can also reveal financial activity; use a disposable test address when possible.

For vulnerabilities, use [SECURITY.md](SECURITY.md) instead of publishing exploit details.

## Work on a change

1. Fork the repository and create a focused branch.
2. Follow the local development instructions in [README.md](README.md#local-development) or [README.ru.md](README.ru.md#локальная-разработка).
3. Keep the change small and explain the behavior it fixes or adds.
4. Run the relevant checks from the repository root:

```bash
npm ci
npm run lint
npm test
npm run format:check
```

For C++ changes, configure and compile as well:

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 2
```

Use deterministic tests for important behavior. Simulate wallet requests and external responses; tests must not spend funds or require private API keys. For wallet and layout changes, also describe the manual desktop/mobile checks you performed and any checks you could not perform.

## Code and review

- Follow the surrounding C++ and JavaScript style.
- Keep token amounts exact when constructing transaction data; do not use floating point for amounts sent to the wallet.
- Preserve the wallet boundary: never request a seed phrase or private key.
- Handle account changes, disconnected providers, rejected requests, and stale asynchronous responses.
- Treat external text as untrusted when rendering HTML.
- Keep existing browser-storage data compatible, or provide a migration.
- Update both README languages when changing documented behavior.
- Do not commit local API keys or domain-specific configuration.

## Open a pull request

Describe the problem, resulting behavior, and validation. Include screenshots for interface changes and note any limitations. Do not describe simulated tests as real wallet execution.

Contributions are submitted under the project's [MIT License](LICENSE). Third-party code or artwork must keep its own required attribution and licensing information.

Be respectful and specific in discussions. Critique the work, not the person; do not post harassment or private information.
