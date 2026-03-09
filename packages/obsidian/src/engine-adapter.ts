import { TFile, Vault } from 'obsidian';
import CludePlugin from './main';

// ============================================================
// TYPES (based on @clude/brain)
// ============================================================

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model';

export interface Memory {
  id: string;
  memory_type: MemoryType;
  content: string;
  summary: string;
  tags: string[];
  concepts: string[];
  emotional_valence: number;
  importance: number;
  access_count: number;
  source: string;
  source_id?: string;
  related_entity?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  last_accessed: string;
  decay_factor: number;
  // Internal scoring (computed at query time)
  _score?: number;
  _vector_sim?: number;
}

export interface StoreOptions {
  type?: MemoryType;
  content: string;
  summary?: string;
  tags?: string[];
  concepts?: string[];
  emotional_valence?: number;
  importance?: number;
  source?: string;
  source_id?: string;
  related_entity?: string;
  metadata?: Record<string, unknown>;
}

export interface RecallOptions {
  query?: string;
  tags?: string[];
  types?: MemoryType[];
  limit?: number;
  min_importance?: number;
  min_decay?: number;
}

export interface MemoryStats {
  total: number;
  by_type: Record<MemoryType, number>;
  avg_importance: number;
  avg_decay: number;
  oldest: string | null;
  newest: string | null;
  top_tags: Array<{ tag: string; count: number }>;
  top_concepts: Array<{ concept: string; count: number }>;
}

export interface MemoryLink {
  source_id: string;
  target_id: string;
  link_type: string;
  strength: number;
}

// ============================================================
// TF-IDF + COSINE SIMILARITY ENGINE
// ============================================================

class DocumentIndex {
  private docs: Map<string, string[]> = new Map();
  private termFreq: Map<string, Map<string, number>> = new Map();
  private docFreq: Map<string, number> = new Map();
  private docCount = 0;

  private stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 
    'with', 'by', 'from', 'is', 'it', 'its', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'not', 'no', 'nor', 'so', 'if',
    'then', 'than', 'that', 'this', 'what', 'which', 'who', 'whom', 'how', 
    'when', 'where', 'why', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'some', 'any', 'about', 'into', 'through', 'just', 'also', 'very',
    'much', 'like', 'get', 'got', 'your', 'you', 'my', 'me', 'his', 'her',
    'our', 'their'
  ]);

  addDocument(id: string, text: string) {
    const terms = this.tokenize(text);
    
    // Remove old document if exists
    this.removeDocument(id);
    
    this.docs.set(id, terms);
    const tf = new Map<string, number>();
    
    // Calculate term frequencies
    terms.forEach(term => {
      tf.set(term, (tf.get(term) || 0) + 1);
    });
    
    this.termFreq.set(id, tf);
    
    // Update document frequencies
    const uniqueTerms = new Set(terms);
    uniqueTerms.forEach(term => {
      this.docFreq.set(term, (this.docFreq.get(term) || 0) + 1);
    });
    
    this.docCount++;
  }

  removeDocument(id: string) {
    const terms = this.docs.get(id);
    if (!terms) return;

    this.docs.delete(id);
    this.termFreq.delete(id);
    
    // Update document frequencies
    const uniqueTerms = new Set(terms);
    uniqueTerms.forEach(term => {
      const freq = this.docFreq.get(term) || 0;
      if (freq <= 1) {
        this.docFreq.delete(term);
      } else {
        this.docFreq.set(term, freq - 1);
      }
    });
    
    this.docCount--;
  }

  search(query: string, limit = 20): Array<{ id: string; score: number }> {
    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return [];

    const queryVector = this.getQueryVector(queryTerms);
    const scores: Array<{ id: string; score: number }> = [];

    for (const [docId] of this.docs) {
      const docVector = this.getDocumentVector(docId);
      const similarity = this.cosineSimilarity(queryVector, docVector);
      
      if (similarity > 0) {
        scores.push({ id: docId, score: similarity });
      }
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 2 && !this.stopwords.has(term));
  }

  private getQueryVector(terms: string[]): Map<string, number> {
    const vector = new Map<string, number>();
    const termCounts = new Map<string, number>();
    
    // Count term frequencies in query
    terms.forEach(term => {
      termCounts.set(term, (termCounts.get(term) || 0) + 1);
    });
    
    // Calculate TF-IDF for each term
    termCounts.forEach((count, term) => {
      const tf = count / terms.length;
      const df = this.docFreq.get(term) || 0;
      const idf = df > 0 ? Math.log(this.docCount / df) : 0;
      vector.set(term, tf * idf);
    });
    
    return vector;
  }

  private getDocumentVector(docId: string): Map<string, number> {
    const vector = new Map<string, number>();
    const tf = this.termFreq.get(docId);
    if (!tf) return vector;

    const docTerms = this.docs.get(docId) || [];
    
    tf.forEach((count, term) => {
      const tfNorm = count / docTerms.length;
      const df = this.docFreq.get(term) || 0;
      const idf = df > 0 ? Math.log(this.docCount / df) : 0;
      vector.set(term, tfNorm * idf);
    });
    
    return vector;
  }

  private cosineSimilarity(vecA: Map<string, number>, vecB: Map<string, number>): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    // Calculate dot product and norms
    const allTerms = new Set([...vecA.keys(), ...vecB.keys()]);
    
    allTerms.forEach(term => {
      const a = vecA.get(term) || 0;
      const b = vecB.get(term) || 0;
      
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    });

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }
}

// ============================================================
// CLUDE ENGINE ADAPTER
// ============================================================

export class CludeEngineAdapter {
  private plugin: CludePlugin;
  private memories: Map<string, Memory> = new Map();
  private links: Map<string, MemoryLink[]> = new Map();
  private index: DocumentIndex = new DocumentIndex();
  private initialized = false;

  constructor(plugin: CludePlugin) {
    this.plugin = plugin;
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      await this.loadFromStorage();
      this.initialized = true;
      console.log(`Loaded ${this.memories.size} memories from storage`);
    } catch (error) {
      console.error('Failed to load memories from storage:', error);
      this.initialized = true; // Continue with empty state
    }
  }

  async store(options: StoreOptions): Promise<Memory> {
    const id = this.generateId();
    const now = new Date().toISOString();
    
    const memory: Memory = {
      id,
      memory_type: options.type || 'semantic',
      content: options.content,
      summary: options.summary || this.generateSummary(options.content),
      tags: options.tags || [],
      concepts: options.concepts || this.extractConcepts(options.content),
      emotional_valence: options.emotional_valence || 0,
      importance: options.importance || this.calculateImportance(options.content, options.tags || []),
      access_count: 0,
      source: options.source || 'obsidian',
      source_id: options.source_id,
      related_entity: options.related_entity,
      metadata: options.metadata || {},
      created_at: now,
      last_accessed: now,
      decay_factor: 1.0,
    };

    // Store memory
    this.memories.set(id, memory);
    
    // Index for search
    this.index.addDocument(id, `${memory.content} ${memory.summary} ${memory.tags.join(' ')} ${memory.concepts.join(' ')}`);
    
    // Auto-link with existing memories
    await this.autoLink(memory);
    
    // Persist to storage
    await this.saveToStorage();
    
    return memory;
  }

  async recall(options: RecallOptions = {}): Promise<Memory[]> {
    const memories: Memory[] = [];
    let candidates = Array.from(this.memories.values());

    // Filter by type
    if (options.types && options.types.length > 0) {
      candidates = candidates.filter(m => options.types!.includes(m.memory_type));
    }

    // Filter by importance and decay
    if (options.min_importance !== undefined) {
      candidates = candidates.filter(m => m.importance >= options.min_importance!);
    }
    
    if (options.min_decay !== undefined) {
      candidates = candidates.filter(m => m.decay_factor >= options.min_decay!);
    }

    // Text search if query provided
    if (options.query) {
      const searchResults = this.index.search(options.query, options.limit || 20);
      const searchScores = new Map(searchResults.map(r => [r.id, r.score]));
      
      candidates = candidates.filter(m => searchScores.has(m.id));
      
      // Add search scores to memories
      candidates.forEach(m => {
        m._vector_sim = searchScores.get(m.id) || 0;
      });
    }

    // Tag filtering
    if (options.tags && options.tags.length > 0) {
      candidates = candidates.filter(m => 
        options.tags!.some(tag => m.tags.includes(tag) || m.concepts.includes(tag))
      );
    }

    // Score and sort memories
    candidates.forEach(m => {
      m._score = this.scoreMemory(m, options);
      // Update access tracking
      m.access_count++;
      m.last_accessed = new Date().toISOString();
    });

    candidates.sort((a, b) => (b._score || 0) - (a._score || 0));

    // Apply limit
    const limit = options.limit || 10;
    memories.push(...candidates.slice(0, limit));

    // Persist access updates
    if (memories.length > 0) {
      await this.saveToStorage();
    }

    return memories;
  }

  async getById(id: string): Promise<Memory | null> {
    return this.memories.get(id) || null;
  }

  async getLinks(memoryId: string): Promise<MemoryLink[]> {
    return this.links.get(memoryId) || [];
  }

  async getStats(): Promise<MemoryStats> {
    const memories = Array.from(this.memories.values());
    
    if (memories.length === 0) {
      return {
        total: 0,
        by_type: { episodic: 0, semantic: 0, procedural: 0, self_model: 0 },
        avg_importance: 0,
        avg_decay: 0,
        oldest: null,
        newest: null,
        top_tags: [],
        top_concepts: []
      };
    }

    const byType: Record<MemoryType, number> = {
      episodic: 0,
      semantic: 0,
      procedural: 0,
      self_model: 0
    };

    const tagCounts = new Map<string, number>();
    const conceptCounts = new Map<string, number>();
    
    let totalImportance = 0;
    let totalDecay = 0;
    let oldest = memories[0].created_at;
    let newest = memories[0].created_at;

    memories.forEach(m => {
      byType[m.memory_type]++;
      totalImportance += m.importance;
      totalDecay += m.decay_factor;
      
      if (m.created_at < oldest) oldest = m.created_at;
      if (m.created_at > newest) newest = m.created_at;
      
      m.tags.forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
      m.concepts.forEach(concept => conceptCounts.set(concept, (conceptCounts.get(concept) || 0) + 1));
    });

    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    const topConcepts = Array.from(conceptCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([concept, count]) => ({ concept, count }));

    return {
      total: memories.length,
      by_type: byType,
      avg_importance: totalImportance / memories.length,
      avg_decay: totalDecay / memories.length,
      oldest,
      newest,
      top_tags: topTags,
      top_concepts: topConcepts
    };
  }

  getAllMemories(): Memory[] {
    return Array.from(this.memories.values());
  }

  async deleteMemory(id: string): Promise<boolean> {
    const memory = this.memories.get(id);
    if (!memory) return false;

    this.memories.delete(id);
    this.index.removeDocument(id);
    this.links.delete(id);
    
    // Remove links pointing to this memory
    for (const [sourceId, links] of this.links) {
      const filtered = links.filter(link => link.target_id !== id);
      if (filtered.length !== links.length) {
        this.links.set(sourceId, filtered);
      }
    }

    await this.saveToStorage();
    return true;
  }

  private scoreMemory(memory: Memory, options: RecallOptions): number {
    const now = Date.now();
    
    // Recency score (exponential decay from last access)
    const hoursSinceAccess = (now - new Date(memory.last_accessed).getTime()) / 3_600_000;
    const recency = Math.pow(0.995, hoursSinceAccess);
    
    // Relevance score (text + tag similarity)
    let relevance = 0.5;
    if (options.query) {
      const queryLower = options.query.toLowerCase();
      const contentLower = `${memory.content} ${memory.summary}`.toLowerCase();
      
      // Simple keyword matching
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
      const matches = queryWords.filter(word => contentLower.includes(word)).length;
      relevance = 0.3 + 0.7 * (matches / Math.max(queryWords.length, 1));
    }
    
    // Tag relevance
    if (options.tags && options.tags.length > 0) {
      const tagMatches = memory.tags.filter(tag => options.tags!.includes(tag)).length;
      const tagRelevance = 0.5 + 0.5 * (tagMatches / options.tags.length);
      relevance = (relevance + tagRelevance) / 2;
    }

    // Vector similarity (from text search)
    const vectorSim = memory._vector_sim || 0;

    // Composite score
    const weights = { recency: 0.15, relevance: 0.25, importance: 0.20, vector: 0.40 };
    let score = (
      weights.recency * recency +
      weights.relevance * relevance +
      weights.importance * memory.importance +
      weights.vector * vectorSim
    );

    // Memory type boost
    const typeBoosts: Record<MemoryType, number> = {
      semantic: 0.15,
      procedural: 0.12,
      self_model: 0.10,
      episodic: 0
    };
    score += typeBoosts[memory.memory_type] || 0;

    // Apply decay factor
    score *= memory.decay_factor;

    return score;
  }

  private async autoLink(memory: Memory) {
    const links: MemoryLink[] = [];
    
    // Find related memories based on entity overlap
    const entities = new Set([...memory.tags, ...memory.concepts]);
    
    for (const [otherId, otherMemory] of this.memories) {
      if (otherId === memory.id) continue;
      
      const otherEntities = new Set([...otherMemory.tags, ...otherMemory.concepts]);
      const overlap = [...entities].filter(e => otherEntities.has(e));
      
      if (overlap.length > 0) {
        const strength = Math.min(overlap.length / Math.max(entities.size, otherEntities.size), 1.0);
        
        if (strength >= 0.2) { // Minimum threshold
          links.push({
            source_id: memory.id,
            target_id: otherId,
            link_type: 'relates',
            strength
          });
        }
      }
    }
    
    if (links.length > 0) {
      this.links.set(memory.id, links);
    }
  }

  private generateId(): string {
    return 'clude-' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }

  private generateSummary(content: string): string {
    // Extract first sentence or first 100 characters
    const sentences = content.split(/[.!?]+/);
    if (sentences.length > 0 && sentences[0].trim().length > 0) {
      return sentences[0].trim();
    }
    return content.substring(0, 100) + (content.length > 100 ? '...' : '');
  }

  private extractConcepts(content: string): string[] {
    const concepts: Set<string> = new Set();
    
    // Extract [[wikilinks]]
    const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = wikilinkRegex.exec(content)) !== null) {
      concepts.add(match[1].toLowerCase());
    }
    
    // Extract #tags
    const tagRegex = /#(\w+)/g;
    while ((match = tagRegex.exec(content)) !== null) {
      concepts.add(match[1].toLowerCase());
    }
    
    // Extract capitalized words (potential entities)
    const entityRegex = /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\b/g;
    while ((match = entityRegex.exec(content)) !== null) {
      const entity = match[0];
      if (entity.length > 2 && entity.split(' ').length <= 3) {
        concepts.add(entity.toLowerCase());
      }
    }
    
    return Array.from(concepts).slice(0, 20); // Limit concepts
  }

  private calculateImportance(content: string, tags: string[]): number {
    let importance = 0.3; // Base importance
    
    // Length factor
    const words = content.split(/\s+/).length;
    importance += Math.min(words / 1000, 0.3);
    
    // Tag factor
    importance += Math.min(tags.length * 0.1, 0.2);
    
    // Wikilink factor
    const wikilinkCount = (content.match(/\[\[[^\]]+\]\]/g) || []).length;
    importance += Math.min(wikilinkCount * 0.05, 0.2);
    
    return Math.min(importance, 1.0);
  }

  private async loadFromStorage() {
    try {
      const data = await this.plugin.loadData();
      if (data && data.memories) {
        // Reconstruct memories map
        for (const [id, memData] of Object.entries(data.memories)) {
          this.memories.set(id, memData as Memory);
          
          // Re-index the memory
          const mem = memData as Memory;
          this.index.addDocument(id, `${mem.content} ${mem.summary} ${mem.tags.join(' ')} ${mem.concepts.join(' ')}`);
        }
        
        // Reconstruct links
        if (data.links) {
          for (const [id, links] of Object.entries(data.links)) {
            this.links.set(id, links as MemoryLink[]);
          }
        }
      }
    } catch (error) {
      console.error('Error loading memories from storage:', error);
    }
  }

  private async saveToStorage() {
    try {
      const data = {
        memories: Object.fromEntries(this.memories),
        links: Object.fromEntries(this.links),
        lastSaved: new Date().toISOString()
      };
      await this.plugin.saveData(data);
    } catch (error) {
      console.error('Error saving memories to storage:', error);
    }
  }
}