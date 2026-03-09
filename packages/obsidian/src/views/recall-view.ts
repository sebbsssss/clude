import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import CludePlugin from '../main';
import { Memory, MemoryType } from '../engine-adapter';

export const RECALL_VIEW_TYPE = 'clude-recall';

export class RecallView extends ItemView {
  private plugin: CludePlugin;
  private searchInput: HTMLInputElement;
  private resultsContainer: HTMLElement;
  private statusContainer: HTMLElement;
  private typeFilters: Map<MemoryType, HTMLButtonElement> = new Map();
  private activeFilters: Set<MemoryType> = new Set();
  private currentResults: Memory[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: CludePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return RECALL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Memory Recall';
  }

  getIcon(): string {
    return 'brain';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('clude-recall-view');

    // Header
    const header = container.createEl('div', { cls: 'clude-recall-header' });
    header.createEl('h3', { text: 'Memory Recall', cls: 'clude-recall-title' });

    // Search input
    const searchContainer = container.createEl('div', { cls: 'clude-search-container' });
    this.searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Search memories...',
      cls: 'clude-search-input'
    });

    this.searchInput.addEventListener('input', () => {
      this.debounceSearch();
    });

    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.performSearch();
      }
    });

    // Type filters
    const filtersContainer = container.createEl('div', { cls: 'clude-filters-container' });
    filtersContainer.createEl('div', { text: 'Memory Types:', cls: 'clude-filters-label' });
    
    const filtersRow = filtersContainer.createEl('div', { cls: 'clude-filters-row' });
    
    const types: MemoryType[] = ['episodic', 'semantic', 'procedural', 'self_model'];
    const typeColors = {
      episodic: 'blue',
      semantic: 'green',
      procedural: 'orange',
      self_model: 'purple'
    };

    types.forEach(type => {
      const button = filtersRow.createEl('button', {
        text: type,
        cls: `clude-type-filter clude-type-${typeColors[type]}`
      });
      
      button.addEventListener('click', () => {
        this.toggleTypeFilter(type, button);
      });
      
      this.typeFilters.set(type, button);
    });

    // Clear filters button
    const clearButton = filtersRow.createEl('button', {
      text: '×',
      cls: 'clude-clear-filters'
    });
    clearButton.addEventListener('click', () => {
      this.clearFilters();
    });

    // Status container
    this.statusContainer = container.createEl('div', { cls: 'clude-status' });

    // Results container
    this.resultsContainer = container.createEl('div', { cls: 'clude-results' });

    // Initial load
    await this.performSearch('', true);

    // Load recent memories by default
    await this.loadRecentMemories();
  }

  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceSearch() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.performSearch();
    }, 300);
  }

  private async performSearch(query?: string, silent = false) {
    const searchQuery = query !== undefined ? query : this.searchInput.value.trim();
    
    if (!silent) {
      this.statusContainer.textContent = 'Searching...';
    }

    try {
      const types = this.activeFilters.size > 0 ? Array.from(this.activeFilters) : undefined;
      
      const memories = await this.plugin.engine.recall({
        query: searchQuery || undefined,
        types,
        limit: 20
      });

      this.currentResults = memories;
      this.displayResults(memories);
      
      if (!silent) {
        this.statusContainer.textContent = `Found ${memories.length} memories`;
      }
    } catch (error) {
      console.error('Search error:', error);
      this.statusContainer.textContent = 'Search error';
    }
  }

  private async loadRecentMemories() {
    try {
      const memories = await this.plugin.engine.recall({ limit: 10 });
      if (memories.length > 0 && this.currentResults.length === 0) {
        this.currentResults = memories;
        this.displayResults(memories);
        this.statusContainer.textContent = `${memories.length} recent memories`;
      }
    } catch (error) {
      console.error('Error loading recent memories:', error);
    }
  }

  private displayResults(memories: Memory[]) {
    this.resultsContainer.empty();

    if (memories.length === 0) {
      this.resultsContainer.createEl('div', {
        text: 'No memories found',
        cls: 'clude-no-results'
      });
      return;
    }

    memories.forEach(memory => {
      this.createMemoryCard(memory);
    });
  }

  private createMemoryCard(memory: Memory) {
    const card = this.resultsContainer.createEl('div', { cls: 'clude-memory-card' });
    
    // Header with type and score
    const header = card.createEl('div', { cls: 'clude-memory-header' });
    
    const typeBadge = header.createEl('span', {
      text: memory.memory_type,
      cls: `clude-type-badge clude-type-${this.getTypeColor(memory.memory_type)}`
    });

    const scoreContainer = header.createEl('div', { cls: 'clude-score-container' });
    
    if (memory._score !== undefined) {
      scoreContainer.createEl('span', {
        text: `${(memory._score * 100).toFixed(0)}%`,
        cls: 'clude-score'
      });
    }
    
    scoreContainer.createEl('span', {
      text: `imp: ${memory.importance.toFixed(1)}`,
      cls: 'clude-importance'
    });

    // Title/Summary
    const titleEl = card.createEl('div', {
      text: memory.summary || memory.content.substring(0, 80) + '...',
      cls: 'clude-memory-title'
    });

    titleEl.addEventListener('click', () => {
      this.openMemorySource(memory);
    });

    // Content snippet
    if (memory.content !== memory.summary) {
      const contentSnippet = memory.content.length > 150 
        ? memory.content.substring(0, 150) + '...'
        : memory.content;
        
      card.createEl('div', {
        text: contentSnippet,
        cls: 'clude-memory-content'
      });
    }

    // Tags and concepts
    if (memory.tags.length > 0 || memory.concepts.length > 0) {
      const tagsContainer = card.createEl('div', { cls: 'clude-tags-container' });
      
      [...memory.tags, ...memory.concepts].slice(0, 5).forEach(tag => {
        const tagEl = tagsContainer.createEl('span', {
          text: tag,
          cls: 'clude-tag'
        });
        
        tagEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.searchByTag(tag);
        });
      });
      
      if (memory.tags.length + memory.concepts.length > 5) {
        tagsContainer.createEl('span', {
          text: `+${memory.tags.length + memory.concepts.length - 5} more`,
          cls: 'clude-tag-more'
        });
      }
    }

    // Actions
    const actions = card.createEl('div', { cls: 'clude-memory-actions' });
    
    const traceButton = actions.createEl('button', {
      text: 'Trace',
      cls: 'clude-action-button'
    });
    traceButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.plugin.showProvenance(memory.id);
    });

    const linkButton = actions.createEl('button', {
      text: 'Links',
      cls: 'clude-action-button'
    });
    linkButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.showMemoryLinks(memory.id);
    });

    // Metadata
    const metadata = card.createEl('div', { cls: 'clude-memory-metadata' });
    const createdDate = new Date(memory.created_at).toLocaleDateString();
    const accessCount = memory.access_count || 0;
    
    metadata.createEl('span', {
      text: `Created: ${createdDate} | Accessed: ${accessCount}x`,
      cls: 'clude-metadata-text'
    });
  }

  private getTypeColor(type: MemoryType): string {
    const colors = {
      episodic: 'blue',
      semantic: 'green',
      procedural: 'orange',
      self_model: 'purple'
    };
    return colors[type] || 'gray';
  }

  private async openMemorySource(memory: Memory) {
    // If memory has source_id (file path), try to open it
    if (memory.source_id && memory.source === 'obsidian') {
      const file = this.app.vault.getAbstractFileByPath(memory.source_id);
      if (file instanceof TFile) {
        await this.app.workspace.openLinkText(file.path, '');
        return;
      }
    }
    
    // Otherwise, create a temporary note with the memory content
    const tempContent = `# Memory: ${memory.summary}

**Type:** ${memory.memory_type}
**Created:** ${memory.created_at}
**Importance:** ${memory.importance}

## Content

${memory.content}

## Tags
${memory.tags.map(tag => `#${tag}`).join(' ')}

## Concepts
${memory.concepts.map(concept => `[[${concept}]]`).join(' ')}

---
*This is a memory from Clude. Original source: ${memory.source}*`;

    // Create temp file in a memories folder
    const fileName = `Memory-${memory.id.slice(-8)}-${Date.now()}.md`;
    const filePath = `memories/${fileName}`;
    
    try {
      // Ensure memories folder exists
      if (!this.app.vault.getAbstractFileByPath('memories')) {
        await this.app.vault.createFolder('memories');
      }
      
      const file = await this.app.vault.create(filePath, tempContent);
      await this.app.workspace.openLinkText(file.path, '');
    } catch (error) {
      console.error('Failed to create temp memory file:', error);
    }
  }

  private searchByTag(tag: string) {
    this.searchInput.value = tag;
    this.performSearch();
  }

  private toggleTypeFilter(type: MemoryType, button: HTMLButtonElement) {
    if (this.activeFilters.has(type)) {
      this.activeFilters.delete(type);
      button.removeClass('active');
    } else {
      this.activeFilters.add(type);
      button.addClass('active');
    }
    
    this.performSearch();
  }

  private clearFilters() {
    this.activeFilters.clear();
    this.typeFilters.forEach(button => {
      button.removeClass('active');
    });
    this.performSearch();
  }

  private async showMemoryLinks(memoryId: string) {
    try {
      const links = await this.plugin.engine.getLinks(memoryId);
      
      if (links.length === 0) {
        new Notice('No links found for this memory');
        return;
      }

      // Create a modal or update the view to show links
      const linkMemories: Memory[] = [];
      
      for (const link of links) {
        const targetMemory = await this.plugin.engine.getById(link.target_id);
        if (targetMemory) {
          linkMemories.push(targetMemory);
        }
      }

      if (linkMemories.length > 0) {
        this.displayResults(linkMemories);
        this.statusContainer.textContent = `Showing ${linkMemories.length} linked memories`;
      }
    } catch (error) {
      console.error('Error loading memory links:', error);
      new Notice('Failed to load memory links');
    }
  }

  async onClose() {
    // Clean up
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }
}