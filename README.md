# Konik Stable

Konik Stable is the web and mobile experience for managing your device experience.

Try it out at https://stable.konik.ai

## Development

`./live.sh` is probably all you want to use (it'll take care of setup).

For a full fresh setup in `$HOME`:
```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc  # or source ~/.zshrc

cd ~
git clone https://github.com/Konik-ai/Stable.git

cd connect
bun install  # sets up pre-commit hook
bun dev
```
