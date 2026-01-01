# opencode-tdd

An OpenCode plugin that enforces TDD (Test-Driven Development) workflow by
intercepting file modifications and ensuring they follow the Red-Green-Refactor
cycle.

## Installation

```bash
bun install
```

## Development

```bash
# Run tests
bun test

# Lint
bun run lint

# Format
bun run format

# Build
bun run build
```

## Usage

Add to your OpenCode configuration:

```json
{
  "plugin": ["opencode-tdd"]
}
```

## License

MIT
