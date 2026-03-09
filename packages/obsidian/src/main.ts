import { Plugin, TFile, TAbstractFile, debounce, Notice } from 'obsidian';
import { CludeEngineAdapter } from './engine-adapter';
import { CludeSettingTab, CludeSettings, DEFAULT_SETTINGS } from './settings';
import { RecallView, RECALL_VIEW_TYPE } from './views/recall-view';
import { StatusBar } from './views/status-bar';
import { parseNoteToMemory } from './utils/note-parser';
import { exportMemoryPack, importMemoryPack } from './utils/memory-pack';
import { ProvenanceModal } from './views/provenance-modal';

export default class CludePlugin extends Plugin {
  settings: CludeSettings;
  engine: CludeEngineAdapter;
  statusBar: StatusBar;
  
  // Debounced auto-sync function
  debouncedSync: (file: TFile) => void;

  async onload() {
    console.log('Loading Clude plugin...');

    // Load settings
    await this.loadSettings();

    // Initialize engine
    this.engine = new CludeEngineAdapter(this);
    await this.engine.initialize();

    // Create debounced sync function
    this.debouncedSync = debounce(
      (file: TFile) => this.syncFileToMemory(file),
      this.settings.syncInterval,
      true
    );

    // Register views
    this.registerView(
      RECALL_VIEW_TYPE,
      (leaf) => new RecallView(leaf, this)
    );

    // Add ribbon icon
    const ribbonIcon = this.addRibbonIcon('brain', 'Clude Memory Panel', () => {
      this.openRecallPanel();
    });
    ribbonIcon.addClass('clude-ribbon-icon');

    // Add status bar
    this.statusBar = new StatusBar(this);
    this.updateStatusBar();

    // Register commands
    this.addCommand({
      id: 'store-current-note',
      name: 'Store current note',
      callback: () => this.storeCurrentNote()
    });

    this.addCommand({
      id: 'recall-memories',
      name: 'Recall memories',
      callback: () => this.openRecallPanel()
    });

    this.addCommand({
      id: 'show-memory-panel',
      name: 'Show memory panel',
      callback: () => this.openRecallPanel()
    });

    this.addCommand({
      id: 'import-memory-pack',
      name: 'Import MemoryPack',
      callback: () => this.importMemoryPack()
    });

    this.addCommand({
      id: 'export-memory-pack',
      name: 'Export MemoryPack',
      callback: () => this.exportMemoryPack()
    });

    // Settings tab
    this.addSettingTab(new CludeSettingTab(this.app, this));

    // File event listeners
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (this.settings.autoSync && file instanceof TFile && file.extension === 'md') {
          this.debouncedSync(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (this.settings.autoSync && file instanceof TFile && file.extension === 'md') {
          // Small delay to ensure file content is available
          setTimeout(() => this.debouncedSync(file), 100);
        }
      })
    );

    // Initial sync of existing notes if enabled
    if (this.settings.autoSync) {
      this.syncExistingNotes();
    }

    console.log('Clude plugin loaded successfully');
  }

  onunload() {
    console.log('Unloading Clude plugin...');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Update debounce interval if changed
    this.debouncedSync = debounce(
      (file: TFile) => this.syncFileToMemory(file),
      this.settings.syncInterval,
      true
    );
  }

  async storeCurrentNote() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      return;
    }

    try {
      await this.syncFileToMemory(activeFile);
      // Show success notification
      new Notice(`Stored "${activeFile.basename}" as memory`);
    } catch (error) {
      console.error('Failed to store note:', error);
      new Notice('Failed to store note as memory');
    }
  }

  async syncFileToMemory(file: TFile) {
    // Check if file should be synced
    if (!this.shouldSyncFile(file)) {
      return;
    }

    try {
      const content = await this.app.vault.read(file);
      const memory = await parseNoteToMemory(file, content, this.app.vault, this.settings);
      
      if (memory) {
        await this.engine.store(memory);
        this.updateStatusBar();
      }
    } catch (error) {
      console.error('Failed to sync file to memory:', file.path, error);
    }
  }

  shouldSyncFile(file: TFile): boolean {
    const path = file.path;
    
    // Check exclude folders
    if (this.settings.excludeFolders.some(folder => 
      path.startsWith(folder) || path.startsWith(folder + '/')
    )) {
      return false;
    }

    // Check include folders (empty means include all)
    if (this.settings.includeFolders.length > 0) {
      return this.settings.includeFolders.some(folder => 
        path.startsWith(folder) || path.startsWith(folder + '/')
      );
    }

    return true;
  }

  async syncExistingNotes() {
    console.log('Syncing existing notes...');
    const files = this.app.vault.getMarkdownFiles();
    let synced = 0;

    for (const file of files) {
      if (this.shouldSyncFile(file)) {
        try {
          await this.syncFileToMemory(file);
          synced++;
        } catch (error) {
          console.error('Failed to sync file:', file.path, error);
        }
      }
    }

    console.log(`Synced ${synced} notes to memory`);
    this.updateStatusBar();
  }

  async openRecallPanel() {
    const { workspace } = this.app;
    
    let leaf = workspace.getLeavesOfType(RECALL_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: RECALL_VIEW_TYPE, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  async updateStatusBar() {
    const stats = await this.engine.getStats();
    this.statusBar.updateCount(stats.total);
  }

  async importMemoryPack() {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.clude-pack.json';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const content = await file.text();
          const imported = await importMemoryPack(content, this.engine);
          new Notice(`Imported ${imported} memories from MemoryPack`);
          this.updateStatusBar();
        }
      };
      input.click();
    } catch (error) {
      console.error('Failed to import MemoryPack:', error);
      new Notice('Failed to import MemoryPack');
    }
  }

  async exportMemoryPack() {
    try {
      const pack = await exportMemoryPack(this.engine, this.settings);
      
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `clude-memories-${new Date().toISOString().split('T')[0]}.clude-pack.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      new Notice(`Exported ${pack.memories.length} memories`);
    } catch (error) {
      console.error('Failed to export MemoryPack:', error);
      new Notice('Failed to export MemoryPack');
    }
  }

  async showProvenance(memoryId: string) {
    new ProvenanceModal(this.app, this.engine, memoryId).open();
  }
}