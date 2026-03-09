import { App, Modal } from 'obsidian';
import { CludeEngineAdapter, Memory, MemoryLink } from '../engine-adapter';

interface ProvenanceNode {
  memory: Memory;
  level: number;
  connections: MemoryLink[];
}

export class ProvenanceModal extends Modal {
  private engine: CludeEngineAdapter;
  private rootMemoryId: string;
  private nodes: Map<string, ProvenanceNode> = new Map();
  private maxDepth = 3;

  constructor(app: App, engine: CludeEngineAdapter, memoryId: string) {
    super(app);
    this.engine = engine;
    this.rootMemoryId = memoryId;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass('clude-provenance-modal');
    
    // Header
    const header = contentEl.createEl('div', { cls: 'clude-provenance-header' });
    header.createEl('h2', { text: 'Memory Provenance', cls: 'clude-provenance-title' });
    
    const closeButton = header.createEl('button', { 
      text: '×', 
      cls: 'clude-close-button' 
    });
    closeButton.addEventListener('click', () => this.close());

    // Loading indicator
    const loading = contentEl.createEl('div', { 
      text: 'Loading provenance chain...', 
      cls: 'clude-loading' 
    });

    try {
      await this.buildProvenanceGraph();
      loading.remove();
      this.renderProvenance();
    } catch (error) {
      loading.textContent = 'Failed to load provenance data';
      console.error('Provenance loading error:', error);
    }
  }

  private async buildProvenanceGraph() {
    const rootMemory = await this.engine.getById(this.rootMemoryId);
    if (!rootMemory) {
      throw new Error('Root memory not found');
    }

    // Start with root memory at level 0
    this.nodes.set(this.rootMemoryId, {
      memory: rootMemory,
      level: 0,
      connections: await this.engine.getLinks(this.rootMemoryId)
    });

    // Build ancestors (memories that link TO this one)
    await this.buildAncestors(this.rootMemoryId, -1);
    
    // Build descendants (memories this one links TO)
    await this.buildDescendants(this.rootMemoryId, 1);
  }

  private async buildAncestors(memoryId: string, level: number) {
    if (Math.abs(level) > this.maxDepth) return;

    // Find all memories that link to this one
    const allMemories = this.engine.getAllMemories();
    
    for (const memory of allMemories) {
      if (this.nodes.has(memory.id)) continue;

      const links = await this.engine.getLinks(memory.id);
      const hasLinkTo = links.some(link => link.target_id === memoryId);
      
      if (hasLinkTo) {
        this.nodes.set(memory.id, {
          memory,
          level,
          connections: links
        });
        
        // Recursively build ancestors of this memory
        await this.buildAncestors(memory.id, level - 1);
      }
    }
  }

  private async buildDescendants(memoryId: string, level: number) {
    if (level > this.maxDepth) return;

    const node = this.nodes.get(memoryId);
    if (!node) return;

    for (const link of node.connections) {
      if (this.nodes.has(link.target_id)) continue;

      const targetMemory = await this.engine.getById(link.target_id);
      if (targetMemory) {
        this.nodes.set(link.target_id, {
          memory: targetMemory,
          level,
          connections: await this.engine.getLinks(link.target_id)
        });
        
        // Recursively build descendants
        await this.buildDescendants(link.target_id, level + 1);
      }
    }
  }

  private renderProvenance() {
    const { contentEl } = this;
    
    // Create main content area
    const content = contentEl.createEl('div', { cls: 'clude-provenance-content' });
    
    // Group nodes by level
    const levelGroups = new Map<number, ProvenanceNode[]>();
    for (const node of this.nodes.values()) {
      if (!levelGroups.has(node.level)) {
        levelGroups.set(node.level, []);
      }
      levelGroups.get(node.level)!.push(node);
    }

    // Sort levels (ancestors first, then root, then descendants)
    const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);

    // Render each level
    sortedLevels.forEach(level => {
      const nodes = levelGroups.get(level)!;
      this.renderLevel(content, level, nodes);
    });

    // Add legend
    this.renderLegend(contentEl);
  }

  private renderLevel(container: HTMLElement, level: number, nodes: ProvenanceNode[]) {
    const levelContainer = container.createEl('div', { cls: 'clude-provenance-level' });
    
    // Level header
    const levelHeader = levelContainer.createEl('div', { cls: 'clude-level-header' });
    let levelTitle = '';
    
    if (level < 0) {
      levelTitle = `Ancestors (${Math.abs(level)} steps back)`;
    } else if (level === 0) {
      levelTitle = 'Root Memory';
    } else {
      levelTitle = `Descendants (${level} steps forward)`;
    }
    
    levelHeader.createEl('h3', { text: levelTitle });
    
    // Arrow indicator
    if (level !== 0) {
      const arrow = levelHeader.createEl('span', { cls: 'clude-level-arrow' });
      arrow.textContent = level > 0 ? '↓' : '↑';
    }

    // Render nodes in this level
    const nodesContainer = levelContainer.createEl('div', { cls: 'clude-level-nodes' });
    
    nodes.forEach(node => {
      this.renderNode(nodesContainer, node, level === 0);
    });
  }

  private renderNode(container: HTMLElement, node: ProvenanceNode, isRoot = false) {
    const nodeEl = container.createEl('div', { 
      cls: `clude-provenance-node ${isRoot ? 'clude-root-node' : ''}` 
    });

    // Memory type badge
    const typeBadge = nodeEl.createEl('span', {
      text: node.memory.memory_type,
      cls: `clude-type-badge clude-type-${this.getTypeColor(node.memory.memory_type)}`
    });

    // Memory title
    const title = nodeEl.createEl('div', {
      text: node.memory.summary || node.memory.content.substring(0, 60) + '...',
      cls: 'clude-node-title'
    });

    title.addEventListener('click', () => {
      this.openMemory(node.memory);
    });

    // Memory metadata
    const metadata = nodeEl.createEl('div', { cls: 'clude-node-metadata' });
    const importance = (node.memory.importance * 100).toFixed(0);
    const accessCount = node.memory.access_count || 0;
    
    metadata.createEl('span', {
      text: `Importance: ${importance}% | Accessed: ${accessCount}x`,
      cls: 'clude-metadata-text'
    });

    // Connection info
    if (node.connections.length > 0) {
      const connectionsEl = nodeEl.createEl('div', { cls: 'clude-node-connections' });
      const connText = node.connections.length === 1 
        ? '1 connection' 
        : `${node.connections.length} connections`;
      
      connectionsEl.createEl('span', {
        text: connText,
        cls: 'clude-connections-text'
      });

      // Show connection types
      const connectionTypes = [...new Set(node.connections.map(c => c.link_type))];
      if (connectionTypes.length > 0) {
        const typesEl = connectionsEl.createEl('div', { cls: 'clude-connection-types' });
        connectionTypes.forEach(type => {
          typesEl.createEl('span', {
            text: type,
            cls: 'clude-connection-type'
          });
        });
      }
    }

    // Tags (limited)
    if (node.memory.tags.length > 0) {
      const tagsContainer = nodeEl.createEl('div', { cls: 'clude-node-tags' });
      node.memory.tags.slice(0, 3).forEach(tag => {
        tagsContainer.createEl('span', {
          text: tag,
          cls: 'clude-tag'
        });
      });
      
      if (node.memory.tags.length > 3) {
        tagsContainer.createEl('span', {
          text: `+${node.memory.tags.length - 3}`,
          cls: 'clude-tag-more'
        });
      }
    }
  }

  private renderLegend(container: HTMLElement) {
    const legend = container.createEl('div', { cls: 'clude-provenance-legend' });
    legend.createEl('h4', { text: 'Legend' });
    
    const legendItems = legend.createEl('div', { cls: 'clude-legend-items' });
    
    // Memory types
    const types = [
      { type: 'episodic', color: 'blue', desc: 'Events & experiences' },
      { type: 'semantic', color: 'green', desc: 'Knowledge & facts' },
      { type: 'procedural', color: 'orange', desc: 'Processes & methods' },
      { type: 'self_model', color: 'purple', desc: 'Goals & reflections' }
    ];

    types.forEach(({ type, color, desc }) => {
      const item = legendItems.createEl('div', { cls: 'clude-legend-item' });
      item.createEl('span', { 
        cls: `clude-type-badge clude-type-${color}`, 
        text: type 
      });
      item.createEl('span', { 
        text: desc, 
        cls: 'clude-legend-desc' 
      });
    });

    // Instructions
    const instructions = legend.createEl('div', { cls: 'clude-legend-instructions' });
    instructions.innerHTML = `
      <p><strong>Navigation:</strong></p>
      <ul>
        <li>Click any memory title to open it</li>
        <li>Ancestors show memories that influenced this one</li>
        <li>Descendants show memories influenced by this one</li>
        <li>Connection strength indicates relationship importance</li>
      </ul>
    `;
  }

  private getTypeColor(type: string): string {
    const colors: Record<string, string> = {
      episodic: 'blue',
      semantic: 'green',
      procedural: 'orange',
      self_model: 'purple'
    };
    return colors[type] || 'gray';
  }

  private async openMemory(memory: Memory) {
    // Close modal first
    this.close();
    
    // If memory has source file, open it
    if (memory.source_id && memory.source === 'obsidian') {
      const file = this.app.vault.getAbstractFileByPath(memory.source_id);
      if (file && 'path' in file) {
        await this.app.workspace.openLinkText(file.path, '');
        return;
      }
    }
    
    // Create temporary note with memory content
    const content = `# ${memory.summary}

**Type:** ${memory.memory_type}  
**Created:** ${new Date(memory.created_at).toLocaleDateString()}  
**Importance:** ${(memory.importance * 100).toFixed(0)}%  
**Source:** ${memory.source}

---

${memory.content}

## Tags
${memory.tags.map(tag => `#${tag}`).join(' ')}

## Concepts  
${memory.concepts.map(concept => `[[${concept}]]`).join(' ')}

---
*Memory ID: ${memory.id}*`;

    try {
      const fileName = `Memory-${memory.id.slice(-8)}.md`;
      const filePath = `memories/${fileName}`;
      
      // Ensure memories folder exists
      if (!this.app.vault.getAbstractFileByPath('memories')) {
        await this.app.vault.createFolder('memories');
      }
      
      // Check if file already exists
      let existingFile = this.app.vault.getAbstractFileByPath(filePath);
      if (!existingFile) {
        existingFile = await this.app.vault.create(filePath, content);
      }
      
      if (existingFile && 'path' in existingFile) {
        await this.app.workspace.openLinkText(existingFile.path, '');
      }
    } catch (error) {
      console.error('Failed to open memory:', error);
      new Notice('Failed to open memory');
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    this.nodes.clear();
  }
}