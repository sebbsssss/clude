import { Plugin } from 'obsidian';
import CludePlugin from '../main';

export class StatusBar {
  private plugin: CludePlugin;
  private statusBarItem: HTMLElement;
  private memoryCount = 0;

  constructor(plugin: CludePlugin) {
    this.plugin = plugin;
    this.statusBarItem = this.plugin.addStatusBarItem();
    this.statusBarItem.addClass('clude-status-bar');
    this.statusBarItem.addEventListener('click', () => {
      this.plugin.openRecallPanel();
    });
    
    this.updateDisplay();
  }

  updateCount(count: number) {
    this.memoryCount = count;
    this.updateDisplay();
  }

  private updateDisplay() {
    this.statusBarItem.empty();
    
    // Brain emoji + count
    const icon = this.statusBarItem.createSpan({ text: '🧠', cls: 'clude-status-icon' });
    const text = this.statusBarItem.createSpan({ 
      text: ` ${this.memoryCount} memories`,
      cls: 'clude-status-text'
    });
    
    // Add tooltip
    this.statusBarItem.setAttribute('aria-label', `Clude: ${this.memoryCount} memories stored. Click to open memory panel.`);
    this.statusBarItem.setAttribute('title', `Clude: ${this.memoryCount} memories stored. Click to open memory panel.`);
  }

  destroy() {
    this.statusBarItem.remove();
  }
}