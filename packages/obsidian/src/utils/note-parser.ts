import { TFile, Vault, CachedMetadata } from 'obsidian';
import { StoreOptions, MemoryType } from '../engine-adapter';
import { CludeSettings } from '../settings';

interface ParsedFrontmatter {
  type?: string;
  memory_type?: MemoryType;
  importance?: number;
  emotional_valence?: number;
  tags?: string[];
  concepts?: string[];
  summary?: string;
  [key: string]: any;
}

export async function parseNoteToMemory(
  file: TFile,
  content: string,
  vault: Vault,
  settings: CludeSettings
): Promise<StoreOptions | null> {
  try {
    // Parse frontmatter
    const { frontmatter, bodyContent } = parseFrontmatter(content);
    
    // Skip empty notes
    if (!bodyContent.trim() && !frontmatter.summary) {
      return null;
    }

    // Extract metadata from file and vault
    const fileMetadata = vault.getMetadata(file);
    
    // Determine memory type
    const memoryType = determineMemoryType(file, frontmatter, settings);
    
    // Extract entities and concepts
    const entities = extractEntities(bodyContent, fileMetadata);
    const concepts = extractConcepts(bodyContent, entities.wikilinks, entities.tags);
    
    // Generate or use provided summary
    const summary = frontmatter.summary || generateSummary(bodyContent, file.basename);
    
    // Calculate importance
    const importance = frontmatter.importance || calculateImportance(
      bodyContent,
      entities,
      fileMetadata,
      file
    );
    
    // Build tags array
    const allTags = [
      ...(frontmatter.tags || []),
      ...entities.tags,
      ...(fileMetadata?.tags?.map(tag => tag.tag.replace('#', '')) || [])
    ];
    const uniqueTags = [...new Set(allTags)];

    const storeOptions: StoreOptions = {
      type: memoryType,
      content: bodyContent,
      summary,
      tags: uniqueTags,
      concepts,
      importance,
      emotional_valence: frontmatter.emotional_valence || 0,
      source: 'obsidian',
      source_id: file.path,
      metadata: {
        filename: file.basename,
        created: file.stat.ctime,
        modified: file.stat.mtime,
        size: file.stat.size,
        frontmatter: frontmatter,
        backlinks: fileMetadata?.backlinks?.length || 0,
        outlinks: fileMetadata?.outlinks?.length || 0
      }
    };

    return storeOptions;
  } catch (error) {
    console.error('Error parsing note to memory:', file.path, error);
    return null;
  }
}

function parseFrontmatter(content: string): { frontmatter: ParsedFrontmatter; bodyContent: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = content.match(frontmatterRegex);
  
  if (!match) {
    return { frontmatter: {}, bodyContent: content };
  }

  const frontmatterText = match[1];
  const bodyContent = content.substring(match[0].length);
  
  // Simple YAML parsing (basic key: value pairs)
  const frontmatter: ParsedFrontmatter = {};
  
  frontmatterText.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      let value: any = line.substring(colonIndex + 1).trim();
      
      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      // Parse arrays (simple format: [item1, item2])
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1)
          .split(',')
          .map((item: string) => item.trim().replace(/^["']|["']$/g, ''))
          .filter((item: string) => item.length > 0);
      }
      
      // Parse numbers
      if (typeof value === 'string' && !isNaN(Number(value))) {
        const num = Number(value);
        if (!isNaN(num)) value = num;
      }
      
      // Parse booleans
      if (value === 'true') value = true;
      if (value === 'false') value = false;
      
      frontmatter[key] = value;
    }
  });

  return { frontmatter, bodyContent };
}

function determineMemoryType(
  file: TFile,
  frontmatter: ParsedFrontmatter,
  settings: CludeSettings
): MemoryType {
  // First check frontmatter
  if (frontmatter.memory_type && isValidMemoryType(frontmatter.memory_type)) {
    return frontmatter.memory_type;
  }
  
  if (frontmatter.type && isValidMemoryType(frontmatter.type)) {
    return frontmatter.type as MemoryType;
  }

  // Check folder mapping
  const filePath = file.path;
  for (const [folder, type] of Object.entries(settings.memoryTypes)) {
    if (filePath.startsWith(folder) || filePath.startsWith(folder + '/')) {
      return type as MemoryType;
    }
  }

  // Content-based heuristics
  const content = frontmatter.content || '';
  const contentLower = content.toLowerCase();
  
  // Episodic indicators
  if (contentLower.includes('today') || 
      contentLower.includes('yesterday') ||
      contentLower.includes('meeting') ||
      contentLower.includes('conversation') ||
      /\b\d{4}-\d{2}-\d{2}\b/.test(content) || // Date patterns
      /\bat \d{1,2}:\d{2}/.test(content)) { // Time patterns
    return 'episodic';
  }

  // Procedural indicators
  if (contentLower.includes('how to') ||
      contentLower.includes('step') ||
      contentLower.includes('process') ||
      contentLower.includes('procedure') ||
      /^\d+\.\s/.test(content) || // Numbered lists
      /^-\s.*\n^-\s/m.test(content)) { // Bullet lists
    return 'procedural';
  }

  // Self-model indicators
  if (contentLower.includes('goal') ||
      contentLower.includes('reflection') ||
      contentLower.includes('i think') ||
      contentLower.includes('i believe') ||
      contentLower.includes('my') ||
      contentLower.includes('personal')) {
    return 'self_model';
  }

  // Default to semantic
  return 'semantic';
}

function isValidMemoryType(type: string): type is MemoryType {
  return ['episodic', 'semantic', 'procedural', 'self_model'].includes(type);
}

interface ExtractedEntities {
  wikilinks: string[];
  tags: string[];
  mentions: string[];
}

function extractEntities(content: string, metadata: CachedMetadata | null): ExtractedEntities {
  const entities: ExtractedEntities = {
    wikilinks: [],
    tags: [],
    mentions: []
  };

  // Extract [[wikilinks]]
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = wikilinkRegex.exec(content)) !== null) {
    let link = match[1];
    // Handle aliased links [[link|alias]]
    if (link.includes('|')) {
      link = link.split('|')[0];
    }
    entities.wikilinks.push(link);
  }

  // Extract #tags
  const tagRegex = /#(\w+(?:\/\w+)*)/g;
  while ((match = tagRegex.exec(content)) !== null) {
    entities.tags.push(match[1]);
  }

  // Extract mentions (capitalized words that might be names/places)
  const mentionRegex = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
  const mentions = content.match(mentionRegex) || [];
  
  // Filter out common words and keep likely entities
  const commonWords = new Set([
    'The', 'This', 'That', 'These', 'Those', 'And', 'But', 'Or', 'So',
    'If', 'When', 'Where', 'Why', 'How', 'What', 'Which', 'Who', 'Whom',
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]);

  mentions.forEach(mention => {
    if (!commonWords.has(mention) && mention.length > 2 && mention.length < 50) {
      entities.mentions.push(mention);
    }
  });

  return entities;
}

function extractConcepts(content: string, wikilinks: string[], tags: string[]): string[] {
  const concepts = new Set<string>();

  // Add wikilinks as concepts
  wikilinks.forEach(link => concepts.add(link.toLowerCase()));

  // Add tags as concepts
  tags.forEach(tag => concepts.add(tag.toLowerCase()));

  // Extract key phrases (simple noun phrases)
  const keyPhraseRegex = /\b(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;
  let match;
  while ((match = keyPhraseRegex.exec(content)) !== null) {
    const phrase = match[1];
    if (phrase.length > 3 && phrase.length < 30 && !phrase.includes(' the ')) {
      concepts.add(phrase.toLowerCase());
    }
  }

  // Extract quoted terms
  const quotedRegex = /"([^"]{3,30})"/g;
  while ((match = quotedRegex.exec(content)) !== null) {
    concepts.add(match[1].toLowerCase());
  }

  return Array.from(concepts).slice(0, 15); // Limit concepts
}

function generateSummary(content: string, filename: string): string {
  // Remove markdown formatting
  let text = content
    .replace(/^#+\s+/gm, '') // Headers
    .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
    .replace(/\*(.*?)\*/g, '$1') // Italic
    .replace(/`(.*?)`/g, '$1') // Code
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // Wikilinks
    .replace(/!\[.*?\]\(.*?\)/g, '') // Images
    .replace(/\[.*?\]\(.*?\)/g, '') // Links
    .replace(/^[-*+]\s+/gm, '') // Lists
    .replace(/^\d+\.\s+/gm, '') // Numbered lists
    .replace(/^>\s+/gm, '') // Blockquotes
    .trim();

  if (!text) {
    return filename.replace(/\.md$/, '');
  }

  // Find first meaningful sentence
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  if (sentences.length > 0) {
    let summary = sentences[0].trim();
    
    // If first sentence is too short, try combining with second
    if (summary.length < 20 && sentences.length > 1) {
      summary += '. ' + sentences[1].trim();
    }
    
    // Limit length
    if (summary.length > 150) {
      summary = summary.substring(0, 147) + '...';
    }
    
    return summary;
  }

  // Fallback to first 100 characters
  return text.substring(0, 100) + (text.length > 100 ? '...' : '');
}

function calculateImportance(
  content: string,
  entities: ExtractedEntities,
  metadata: CachedMetadata | null,
  file: TFile
): number {
  let importance = 0.3; // Base importance

  // Content length factor
  const wordCount = content.split(/\s+/).length;
  importance += Math.min(wordCount / 1000, 0.25);

  // Entity richness
  const totalEntities = entities.wikilinks.length + entities.tags.length + entities.mentions.length;
  importance += Math.min(totalEntities * 0.02, 0.2);

  // Backlink factor (if metadata available)
  if (metadata?.backlinks) {
    importance += Math.min(metadata.backlinks.length * 0.05, 0.15);
  }

  // Outlink factor
  if (metadata?.outlinks) {
    importance += Math.min(metadata.outlinks.length * 0.02, 0.1);
  }

  // File age factor (newer files get slight boost)
  const now = Date.now();
  const daysSinceCreated = (now - file.stat.ctime) / (1000 * 60 * 60 * 24);
  if (daysSinceCreated < 7) {
    importance += 0.1 * (7 - daysSinceCreated) / 7;
  }

  // Structural complexity (headers, lists, etc.)
  const headerCount = (content.match(/^#+\s+/gm) || []).length;
  const listItemCount = (content.match(/^[-*+]\s+/gm) || []).length;
  const structureScore = Math.min((headerCount + listItemCount) * 0.02, 0.1);
  importance += structureScore;

  return Math.min(importance, 1.0);
}