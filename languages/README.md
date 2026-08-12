# Language plugins

Each subdirectory is one language plugin:

```
languages/
  <id>/
    language.json              # required manifest
    grammar.tmLanguage.json    # TextMate grammar (JSON)
```

## `language.json`

```json
{
  "id": "python",
  "aliases": ["Python", "py"],
  "extensions": [".py", ".pyw"],
  "scopeName": "source.python",
  "grammar": "grammar.tmLanguage.json"
}
```

- `id`: Monaco language id (unique)
- `scopeName`: must match the grammar's `scopeName`
- `grammar`: path relative to the plugin folder

Drop a new folder here and restart the app to load it. No install step.
