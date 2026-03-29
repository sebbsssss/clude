/**
 * Performance verification tests for the chat hot/cold state split refactor.
 *
 * These tests verify the STRUCTURAL guarantees of the refactor by reading
 * the source code and checking key properties. They don't render React
 * components — they verify the architecture is correct.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const CHAT_SRC = join(__dirname, '../..');

function readChatFile(path: string): string {
  return readFileSync(join(CHAT_SRC, path), 'utf-8');
}

describe('Chat hot/cold state split — structural verification', () => {
  describe('Phase 0: State split', () => {
    it('useChat has no setMessages — old pattern eliminated', () => {
      const src = readChatFile('hooks/useChat.ts');
      expect(src).not.toContain('setMessages');
    });

    it('useChat uses separate settled and streamingMsg state', () => {
      const src = readChatFile('hooks/useChat.ts');
      expect(src).toContain('useState<SettledMessage[]>');
      expect(src).toContain('useState<StreamingState | null>');
    });

    it('chunks write to contentRef, not to state', () => {
      const src = readChatFile('hooks/useChat.ts');
      // Every onChunk callback should write to contentRef
      const chunkCallbacks = src.match(/\(chunk\) => \{[^}]+\}/g) || [];
      expect(chunkCallbacks.length).toBeGreaterThanOrEqual(2);
      for (const cb of chunkCallbacks) {
        expect(cb).toContain('contentRef.current');
        expect(cb).not.toContain('setSettled');
        expect(cb).not.toContain('setStreamingMsg');
      }
    });

    it('sendMessage does not depend on settled/messages state', () => {
      const src = readChatFile('hooks/useChat.ts');
      // Find the sendMessage useCallback dependency array
      const sendMessageMatch = src.match(
        /const sendMessage = useCallback\(async[\s\S]*?\}, \[([^\]]*)\]\)/
      );
      expect(sendMessageMatch).toBeTruthy();
      const deps = sendMessageMatch![1];
      expect(deps).not.toContain('settled');
      expect(deps).not.toContain('messages');
      expect(deps).toContain('authenticated');
    });

    it('sendMessage reads history from settledRef (ref pattern)', () => {
      const src = readChatFile('hooks/useChat.ts');
      expect(src).toContain('settledRef.current.slice(-10)');
    });
  });

  describe('Phase 1: Component decomposition', () => {
    it('SettledBubble uses React.memo', () => {
      const src = readChatFile('components/MessageBubble.tsx');
      expect(src).toMatch(/export const SettledBubble = memo\(/);
    });

    it('StreamingBubble uses React.memo', () => {
      const src = readChatFile('components/MessageBubble.tsx');
      expect(src).toMatch(/export const StreamingBubble = memo\(/);
    });

    it('SettledBubble uses StaticAvatar (no LiquidMetal)', () => {
      const src = readChatFile('components/MessageBubble.tsx');
      // Find the SettledBubble function body
      const settledMatch = src.match(
        /export const SettledBubble = memo\(function SettledBubble[\s\S]*?^\}\);/m
      );
      expect(settledMatch).toBeTruthy();
      const settledBody = settledMatch![0];
      expect(settledBody).toContain('StaticAvatar');
      expect(settledBody).not.toContain('<LiquidMetal');
    });

    it('StreamingBubble uses LiquidMetal (live shaders)', () => {
      const src = readChatFile('components/MessageBubble.tsx');
      const streamingMatch = src.match(
        /export const StreamingBubble = memo\(function StreamingBubble[\s\S]*?^\}\);/m
      );
      expect(streamingMatch).toBeTruthy();
      expect(streamingMatch![0]).toContain('LiquidMetal');
    });

    it('StreamingBubble renders raw text, not Markdown', () => {
      const src = readChatFile('components/MessageBubble.tsx');
      const streamingMatch = src.match(
        /export const StreamingBubble = memo\(function StreamingBubble[\s\S]*?^\}\);/m
      );
      expect(streamingMatch).toBeTruthy();
      const body = streamingMatch![0];
      expect(body).not.toContain('<Markdown');
      expect(body).toContain('whitespace-pre-wrap');
    });

    it('SettledBubble renders Markdown (formatted content)', () => {
      const src = readChatFile('components/MessageBubble.tsx');
      const settledMatch = src.match(
        /export const SettledBubble = memo\(function SettledBubble[\s\S]*?^\}\);/m
      );
      expect(settledMatch).toBeTruthy();
      expect(settledMatch![0]).toContain('<Markdown');
    });

    it('InputArea is extracted and uses memo', () => {
      const src = readChatFile('components/InputArea.tsx');
      expect(src).toMatch(/export const InputArea = memo\(/);
    });

    it('InputArea owns isFocused, inputValue, selectedModel state', () => {
      const src = readChatFile('components/InputArea.tsx');
      expect(src).toContain("useState(false)"); // isFocused
      expect(src).toContain("useState('')"); // inputValue
      expect(src).toContain("useState("); // selectedModel
    });

    it('chat-interface.tsx is slimmed down (no LiquidMetal import, no renderAvatar)', () => {
      const src = readChatFile('components/chat-interface.tsx');
      // No LiquidMetal/PulsingBorder imports — shaders live in child components only
      expect(src).not.toContain("from '@paper-design/shaders-react'");
      expect(src).not.toContain('renderAvatar');
    });
  });

  describe('Phase 2: Scroll & animation', () => {
    it('uses IntersectionObserver instead of scroll handler', () => {
      const src = readChatFile('components/chat-interface.tsx');
      expect(src).toContain('IntersectionObserver');
      expect(src).not.toContain("addEventListener('scroll'");
    });

    it('settled messages rendered without motion.div', () => {
      const src = readChatFile('components/chat-interface.tsx');
      // SettledBubble should be rendered directly, not wrapped in motion.div
      expect(src).toContain('<SettledBubble');
      // The map over settled should NOT use motion.div
      const settledMap = src.match(/settled\.map[\s\S]*?<SettledBubble/);
      expect(settledMap).toBeTruthy();
      expect(settledMap![0]).not.toContain('motion.div');
    });
  });

  describe('Phase 3: Instant guest mode', () => {
    it('useAuth starts with ready=true', () => {
      const src = readChatFile('hooks/useAuth.ts');
      expect(src).toMatch(/useState\(true\)/); // ready starts true
    });

    it('no 5-second timeout hack', () => {
      const src = readChatFile('hooks/useAuth.ts');
      expect(src).not.toContain('5000');
      expect(src).not.toContain('timed out');
    });
  });

  describe('Phase 4: Memoization', () => {
    it('ConversationList uses React.memo', () => {
      const src = readChatFile('components/ConversationList.tsx');
      expect(src).toMatch(/= memo\(function ConversationList/);
    });

    it('ConversationList memoizes groupByTime', () => {
      const src = readChatFile('components/ConversationList.tsx');
      expect(src).toContain('useMemo(() => groupByTime(conversations)');
    });

    it('MemoryPills uses React.memo', () => {
      const src = readChatFile('components/MemoryPills.tsx');
      expect(src).toMatch(/= memo\(function MemoryPills/);
    });

    it('ModelSelector memoizes filter operations', () => {
      const src = readChatFile('components/ModelSelector.tsx');
      expect(src).toContain("useMemo(() => models.filter");
    });

    it('StaticAvatar uses React.memo', () => {
      const src = readChatFile('components/StaticAvatar.tsx');
      expect(src).toMatch(/= memo\(function StaticAvatar/);
    });

    it('avatar shader props are module-level constants', () => {
      const src = readChatFile('components/MessageBubble.tsx');
      expect(src).toMatch(/^const AVATAR_SHADER_PROPS = \{/m);
    });
  });

  describe('Type system guarantees', () => {
    it('SettledMessage has readonly fields', () => {
      const src = readChatFile('lib/types.ts');
      const settledMatch = src.match(
        /export interface SettledMessage \{[\s\S]*?\}/
      );
      expect(settledMatch).toBeTruthy();
      const body = settledMatch![0];
      // All fields should be readonly
      const fields = body.match(/^\s+(readonly )?\w+/gm) || [];
      const nonReadonly = fields.filter(f => !f.includes('readonly') && !f.includes('{'));
      expect(nonReadonly).toHaveLength(0);
    });

    it('StreamingState has mutable content field', () => {
      const src = readChatFile('lib/types.ts');
      const streamingMatch = src.match(
        /export interface StreamingState \{[\s\S]*?\}/
      );
      expect(streamingMatch).toBeTruthy();
      const body = streamingMatch![0];
      // content should NOT be readonly (it's the hot field)
      expect(body).toMatch(/^\s+content: string;/m);
      // But other fields should be readonly
      expect(body).toContain('readonly id:');
      expect(body).toContain('readonly role:');
    });

    it('DisplayMessage is discriminated union on kind', () => {
      const src = readChatFile('lib/types.ts');
      expect(src).toContain("type DisplayMessage = SettledMessage | StreamingState");
      // Both types have kind field
      expect(src).toContain("readonly kind: 'settled'");
      expect(src).toContain("readonly kind: 'streaming'");
    });
  });
});
