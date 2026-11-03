# Security

RuDeFi interacts with wallets and third-party transaction builders. Reports affecting signing requests, approval amounts, wallet selection, address handling, injected content, or exposure of locally stored keys are especially useful.

## Report privately

Use GitHub's **Security → Report a vulnerability** option if private vulnerability reporting is enabled for this repository.

If that option is unavailable, open an issue titled **Private security contact requested** without the vulnerability details, exploit code, addresses, credentials, or affected user data. Ask the maintainer for a private reporting channel before sharing the report.

Do not publish a working exploit against a live user or send real funds to demonstrate a problem. Prefer a local reproduction with a simulated provider or a disposable test environment.

A useful private report includes the affected commit, a description of the issue, reproduction steps, expected impact, and a proposed fix if available. Redact secrets from logs and screenshots.

## Scope and maintenance

Report against the latest `main` when possible. The project has no published long-term-support policy or guaranteed response time; older commits may require updating before a fix is provided.

Risk labels returned by external services are not security guarantees. Regression tests use simulated providers and responses and do not constitute a smart-contract or application security audit.
