import { App, PluginSettingTab, Setting } from 'obsidian';
import CludePlugin from './main';

export interface CludeSettings {
  autoSync: boolean;
  syncInterval: number;
  includeFolders: string[];
  excludeFolders: string[];
  memoryTypes: Record<string, string>;
  cloudMode: boolean;
  cloudApiUrl: string;
  cloudApiKey: string;
}

export const DEFAULT_SETTINGS: CludeSettings = {
  autoSync: true,
  syncInterval: 5000,
  includeFolders: [],
  excludeFolders: ['.trash', 'templates'],
  memoryTypes: {
    'daily/': 'episodic',
    'journal/': 'episodic',
    'notes/': 'semantic',
    'reference/': 'semantic',
    'procedures/': 'procedural',
    'processes/': 'procedural',
    'goals/': 'self_model',
    'reflections/': 'self_model'
  },
  cloudMode: false,
  cloudApiUrl: 'https://api.clude.io',
  cloudApiKey: ''
};

export class CludeSettingTab extends PluginSettingTab {
  plugin: CludePlugin;

  constructor(app: App, plugin: CludePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl('h2', { text: 'Clude — AI Memory Engine Settings' });

    // Auto-sync settings
    containerEl.createEl('h3', { text: 'Sync Settings' });

    new Setting(containerEl)
      .setName('Auto-sync notes')
      .setDesc('Automatically store notes as memories when they are saved')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoSync)
        .onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Sync delay (ms)')
      .setDesc('Delay before syncing after file modification (to avoid excessive syncing while typing)')
      .addSlider(slider => slider
        .setLimits(1000, 30000, 1000)
        .setValue(this.plugin.settings.syncInterval)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.syncInterval = value;
          await this.plugin.saveSettings();
        }));

    // Folder settings
    containerEl.createEl('h3', { text: 'Folder Settings' });

    new Setting(containerEl)
      .setName('Include folders')
      .setDesc('Only sync notes from these folders (leave empty to include all). One folder per line.')
      .addTextArea(text => text
        .setPlaceholder('daily/\nnotes/\nprojects/')
        .setValue(this.plugin.settings.includeFolders.join('\n'))
        .onChange(async (value) => {
          this.plugin.settings.includeFolders = value
            .split('\n')
            .map(f => f.trim())
            .filter(f => f.length > 0);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Exclude folders')
      .setDesc('Never sync notes from these folders. One folder per line.')
      .addTextArea(text => text
        .setPlaceholder('.trash\ntemplates\narchive/')
        .setValue(this.plugin.settings.excludeFolders.join('\n'))
        .onChange(async (value) => {
          this.plugin.settings.excludeFolders = value
            .split('\n')
            .map(f => f.trim())
            .filter(f => f.length > 0);
          await this.plugin.saveSettings();
        }));

    // Memory type mapping
    containerEl.createEl('h3', { text: 'Memory Type Mapping' });
    containerEl.createEl('p', { 
      text: 'Map folder paths to memory types. Format: folder_path=memory_type (one per line)',
      cls: 'setting-item-description'
    });

    const memoryTypeText = Object.entries(this.plugin.settings.memoryTypes)
      .map(([folder, type]) => `${folder}=${type}`)
      .join('\n');

    new Setting(containerEl)
      .setName('Folder → Memory Type')
      .setDesc('Folder paths and their corresponding memory types (episodic, semantic, procedural, self_model)')
      .addTextArea(text => text
        .setPlaceholder('daily/=episodic\nnotes/=semantic\nprocedures/=procedural\ngoals/=self_model')
        .setValue(memoryTypeText)
        .onChange(async (value) => {
          const mapping: Record<string, string> = {};
          value.split('\n').forEach(line => {
            const [folder, type] = line.split('=').map(s => s.trim());
            if (folder && type && ['episodic', 'semantic', 'procedural', 'self_model'].includes(type)) {
              mapping[folder] = type;
            }
          });
          this.plugin.settings.memoryTypes = mapping;
          await this.plugin.saveSettings();
        }));

    // Cloud sync settings
    containerEl.createEl('h3', { text: 'Cloud Sync (Optional)' });

    new Setting(containerEl)
      .setName('Enable cloud mode')
      .setDesc('Sync memories with Clude cloud for cross-device access')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.cloudMode)
        .onChange(async (value) => {
          this.plugin.settings.cloudMode = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Cloud API URL')
      .setDesc('Clude API endpoint URL')
      .addText(text => text
        .setPlaceholder('https://api.clude.io')
        .setValue(this.plugin.settings.cloudApiUrl)
        .onChange(async (value) => {
          this.plugin.settings.cloudApiUrl = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Cloud API Key')
      .setDesc('Your Clude API key for cloud sync')
      .addText(text => text
        .setPlaceholder('clude_...')
        .setValue(this.plugin.settings.cloudApiKey)
        .onChange(async (value) => {
          this.plugin.settings.cloudApiKey = value;
          await this.plugin.saveSettings();
        }));

    // Memory type definitions
    containerEl.createEl('h3', { text: 'Memory Types' });
    const typeDesc = containerEl.createDiv();
    typeDesc.innerHTML = `
      <div style="margin: 10px 0; font-size: 14px; line-height: 1.4;">
        <div><strong style="color: var(--color-blue);">episodic</strong> — Events, conversations, time-bound experiences</div>
        <div><strong style="color: var(--color-green);">semantic</strong> — Facts, knowledge, definitions, references</div>
        <div><strong style="color: var(--color-orange);">procedural</strong> — How-tos, processes, workflows, methods</div>
        <div><strong style="color: var(--color-purple);">self_model</strong> — Goals, reflections, beliefs, identity</div>
      </div>
    `;
  }
}