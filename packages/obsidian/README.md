# Clude — AI Memory Engine for Obsidian

Give your vault a cognitive memory system. Store, recall, and trace connections between notes using Clude's AI memory engine.

## Features

### 🧠 Memory System
- **Auto-sync notes** — Automatically store notes as memories when saved
- **Manual storage** — Store individual notes with the "Store current note" command
- **Memory types** — Notes are classified as episodic, semantic, procedural, or self-model based on content and location

### 🔍 Smart Recall  
- **Search memories** — Query your entire vault's memory with intelligent ranking
- **Memory panel** — Right sidebar view for browsing and searching memories
- **Related memories** — Find connections across your vault beyond just backlinks
- **Filter by type** — Focus on specific memory types (episodic, semantic, etc.)

### 🔗 Memory Connections
- **Auto-linking** — Memories are automatically connected based on shared entities and concepts
- **Provenance view** — Trace the ancestry and descendants of any memory
- **Entity graph** — Discover relationships between people, projects, and concepts

### 📦 Memory Packs
- **Export memories** — Create portable MemoryPack files for sharing or backup
- **Import MemoryPacks** — Add memories from other Clude instances or users
- **Cross-device sync** — Optional cloud mode for syncing across devices

## Installation

### Manual Installation
1. Download the latest release
2. Extract to `.obsidian/plugins/clude/`
3. Enable the plugin in Obsidian settings

### From Community Plugins (Coming Soon)
Search for "Clude" in the Community Plugins section of Obsidian settings.

## Usage

### Basic Setup
1. Enable the plugin in Settings → Community Plugins
2. Configure sync settings in Settings → Clude
3. The plugin will automatically start syncing your notes as memories

### Memory Types
The plugin automatically classifies notes into memory types based on content and folder structure:

- **🔵 Episodic** — Events, meetings, daily notes, time-bound experiences
- **🟢 Semantic** — Facts, knowledge, definitions, reference material  
- **🟠 Procedural** — How-tos, processes, workflows, step-by-step guides
- **🟣 Self-model** — Goals, reflections, beliefs, personal insights

### Commands
- `Ctrl+P` → "Store current note" — Manually store the active note
- `Ctrl+P` → "Recall memories" — Open the memory search panel
- `Ctrl+P` → "Import MemoryPack" — Import memories from a .clude-pack.json file
- `Ctrl+P` → "Export MemoryPack" — Export all memories to a shareable file

### Memory Panel
Click the brain icon (🧠) in the ribbon or use "Show memory panel" to open the recall view:
- Type queries to search across all memories
- Filter by memory type using the colored buttons
- Click memory titles to open the source note
- Use "Trace" to explore memory connections
- Click tags to search for related memories

## Configuration

### Sync Settings
- **Auto-sync** — Automatically store notes as memories when saved
- **Sync delay** — Debounce time to avoid excessive syncing while typing
- **Include/exclude folders** — Control which parts of your vault are synced

### Memory Type Mapping
Configure how folders map to memory types:
```
daily/ = episodic
journal/ = episodic  
notes/ = semantic
reference/ = semantic
procedures/ = procedural
goals/ = self_model
```

### Cloud Sync (Optional)
Connect to Clude cloud for cross-device synchronization:
- Enable cloud mode
- Add your Clude API URL and key
- Memories sync across all your devices

## Privacy & Data

- **Local-first** — All memories stored locally in your vault by default
- **No API keys required** — Works 100% offline with built-in text similarity
- **Your data stays yours** — Memories stored in `.obsidian/plugins/clude/`
- **Optional cloud sync** — Only if you explicitly configure and enable it

## Technical Details

### Memory Storage
- Memories stored in plugin data directory as JSON
- Uses TF-IDF + cosine similarity for text search (no external dependencies)
- Entity extraction via regex patterns (wikilinks, tags, capitalized words)
- Importance scoring based on content length, connections, and metadata

### Memory Connections
- Auto-generated based on shared entities, tags, and concepts
- Strength calculated from overlap and co-occurrence patterns
- Displayed in provenance view as ancestor/descendant chains

### Performance
- Lightweight implementation optimized for Obsidian
- Debounced sync to prevent performance issues while typing
- Incremental indexing for fast search
- Memory limits and cleanup for large vaults

## Development

### Building
```bash
npm install
npm run build
```

### Development Mode  
```bash
npm run dev
```

### File Structure
```
src/
├── main.ts              # Plugin entry point
├── settings.ts          # Settings tab and configuration
├── engine-adapter.ts    # Lightweight memory engine
├── views/
│   ├── recall-view.ts   # Memory search panel
│   ├── provenance-modal.ts # Memory trace chains
│   └── status-bar.ts    # Status bar element
└── utils/
    ├── note-parser.ts   # Parse Obsidian notes → memories  
    └── memory-pack.ts   # Import/export MemoryPacks
```

## Roadmap

- [ ] Visual memory graph view
- [ ] Memory consolidation (merge similar memories)
- [ ] Advanced entity recognition
- [ ] Memory decay simulation
- [ ] Integration with Clude desktop app
- [ ] Collaborative memory sharing
- [ ] Memory templates and workflows

## Support

- **Issues** — Report bugs on GitHub
- **Features** — Request features via GitHub issues  
- **Discord** — Join the Clude community
- **Docs** — Full documentation at docs.clude.io

## License

MIT License — see LICENSE file for details.

---

**Made with 🧠 by the Clude team**