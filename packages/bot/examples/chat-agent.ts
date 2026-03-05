/**
 * Chat Agent — Interactive agent that remembers conversations.
 *
 * Stores each exchange as an episodic memory. Recalls relevant context
 * before generating each response. Runs dream cycles on a schedule.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_KEY=... ANTHROPIC_API_KEY=... npx tsx examples/chat-agent.ts
 */

import { Cortex } from 'clude-bot';
import Anthropic from '@anthropic-ai/sdk';
import * as readline from 'readline';

async function main() {
  const brain = new Cortex({
    supabase: {
      url: process.env.SUPABASE_URL!,
      serviceKey: process.env.SUPABASE_KEY!,
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY!,
    },
    // Optional: add embeddings for vector search
    // embedding: { provider: 'voyage', apiKey: process.env.VOYAGE_API_KEY! },
  });

  await brain.init();
  brain.startDreamSchedule();

  const anthropic = new Anthropic();
  const userId = 'demo-user';

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('Chat agent ready. Type a message (ctrl+c to quit).\n');

  const ask = () => {
    rl.question('You: ', async (message) => {
      if (!message.trim()) return ask();

      // Recall relevant memories for this user
      const memories = await brain.recall({
        query: message,
        relatedUser: userId,
        limit: 5,
      });

      const context = brain.formatContext(memories);

      // Generate response
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 500,
        system: `You are a helpful assistant with memory.\n\n## What you remember\n${context}`,
        messages: [{ role: 'user', content: message }],
      });

      const reply = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log(`\nAgent: ${reply}\n`);

      // Store this interaction
      await brain.store({
        type: 'episodic',
        content: `User: ${message}\nAssistant: ${reply}`,
        summary: `Conversation about ${message.slice(0, 60)}`,
        source: 'chat',
        relatedUser: userId,
        tags: brain.inferConcepts(message, 'chat', []),
      });

      ask();
    });
  };

  ask();

  process.on('SIGINT', () => {
    brain.destroy();
    rl.close();
    process.exit(0);
  });
}

main().catch(console.error);
