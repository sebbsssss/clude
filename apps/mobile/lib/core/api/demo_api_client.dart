import 'dart:convert';

import 'package:dio/dio.dart';

import 'api_client.dart';
import 'models/agent.dart';
import 'models/chat_model.dart';
import 'models/conversation.dart';
import 'models/entity_data.dart';
import 'models/graph_data.dart';
import 'models/memory_stats.dart';
import 'models/memory_summary.dart';
import 'models/message.dart';
import 'models/responses.dart';
import 'sse_parser.dart';

/// Mock API client returning hardcoded demo data.
/// Used for simulator testing without a live server.
/// To remove: delete this file + references in api_client_provider.dart,
/// auth_notifier.dart, and login_screen.dart.
class DemoApiClient extends ApiClient {
  DemoApiClient() : super(Dio());

  Future<void> _delay() => Future.delayed(const Duration(milliseconds: 300));

  // ── Auth ──────────────────────────────────────────────────────────────

  @override
  Future<AutoRegisterResponse> autoRegister(String privyToken, [String? wallet]) async {
    await _delay();
    return const AutoRegisterResponse(apiKey: 'clk_demo_mode', agentId: 'agent-demo', created: false);
  }

  @override
  Future<bool> validateKey() async {
    await _delay();
    return true;
  }

  // ── Models ────────────────────────────────────────────────────────────

  @override
  Future<List<ChatModel>> getModels() async {
    await _delay();
    return const [
      ChatModel(
        id: 'gpt-4o',
        name: 'GPT-4o',
        privacy: 'anonymized',
        context: 128000,
        isDefault: true,
        tier: 'free',
        cost: ModelCost(input: 2.50, output: 10.00),
      ),
      ChatModel(
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        privacy: 'private',
        context: 200000,
        tier: 'free',
        cost: ModelCost(input: 3.00, output: 15.00),
      ),
      ChatModel(
        id: 'claude-opus-4-20250514',
        name: 'Claude Opus 4',
        privacy: 'private',
        context: 200000,
        tier: 'pro',
        cost: ModelCost(input: 15.00, output: 75.00),
      ),
    ];
  }

  // ── Conversations ──────────────��──────────────────────────────────────

  @override
  Future<Conversation> createConversation({String? model}) async {
    await _delay();
    return Conversation(
      id: 'demo-new-${DateTime.now().millisecondsSinceEpoch}',
      ownerWallet: 'demo_wallet',
      title: null,
      model: model ?? 'gpt-4o',
      messageCount: 0,
      createdAt: DateTime.now().toIso8601String(),
      updatedAt: DateTime.now().toIso8601String(),
    );
  }

  @override
  Future<List<Conversation>> listConversations({int limit = 50}) async {
    await _delay();
    return [
      Conversation(id: 'conv-1', ownerWallet: 'demo', title: 'Building a Flutter app', model: 'gpt-4o', messageCount: 12, createdAt: '2026-04-05T10:00:00Z', updatedAt: '2026-04-05T14:30:00Z'),
      Conversation(id: 'conv-2', ownerWallet: 'demo', title: 'Solana wallet integration', model: 'claude-sonnet-4-20250514', messageCount: 8, createdAt: '2026-04-04T09:00:00Z', updatedAt: '2026-04-04T11:00:00Z'),
      Conversation(id: 'conv-3', ownerWallet: 'demo', title: 'Memory system architecture', model: 'gpt-4o', messageCount: 15, createdAt: '2026-04-03T16:00:00Z', updatedAt: '2026-04-03T18:00:00Z'),
      Conversation(id: 'conv-4', ownerWallet: 'demo', title: 'Dream cycle optimization', model: 'claude-sonnet-4-20250514', messageCount: 6, createdAt: '2026-04-02T08:00:00Z', updatedAt: '2026-04-02T09:30:00Z'),
      Conversation(id: 'conv-5', ownerWallet: 'demo', title: 'Token economics brainstorm', model: 'gpt-4o', messageCount: 20, createdAt: '2026-04-01T12:00:00Z', updatedAt: '2026-04-01T15:00:00Z'),
    ];
  }

  @override
  Future<ConversationDetail> getConversation(String id, {String? before}) async {
    await _delay();
    return ConversationDetail(
      id: id,
      ownerWallet: 'demo',
      title: 'Building a Flutter app',
      model: 'gpt-4o',
      messageCount: 4,
      createdAt: '2026-04-05T10:00:00Z',
      updatedAt: '2026-04-05T14:30:00Z',
      hasMore: false,
      messages: [
        Message(id: 'msg-1', conversationId: id, role: 'user', content: 'How do I set up Riverpod in a Flutter project?', createdAt: '2026-04-05T10:00:00Z'),
        Message(id: 'msg-2', conversationId: id, role: 'assistant', content: 'To set up Riverpod in Flutter:\n\n1. Add `flutter_riverpod` to your `pubspec.yaml`\n2. Wrap your app with `ProviderScope`\n3. Use `ConsumerWidget` or `ConsumerStatefulWidget` for widgets that read providers\n\nHere\'s a quick example:\n\n```dart\nvoid main() {\n  runApp(ProviderScope(child: MyApp()));\n}\n```', model: 'gpt-4o', memoryIds: [101, 102], createdAt: '2026-04-05T10:01:00Z'),
        Message(id: 'msg-3', conversationId: id, role: 'user', content: 'What about StateNotifier vs AsyncNotifier?', createdAt: '2026-04-05T10:05:00Z'),
        Message(id: 'msg-4', conversationId: id, role: 'assistant', content: 'Great question! **StateNotifier** is the Riverpod 2.x approach — you define a class extending `StateNotifier<T>` and mutate `state` directly.\n\n**AsyncNotifier** (Riverpod 3.x codegen) uses `@riverpod` annotations and handles async state automatically with `AsyncValue`.\n\nFor your project using Riverpod 2.x, stick with `StateNotifier`. It\'s well-tested and matches your existing patterns.', model: 'gpt-4o', memoryIds: [103], createdAt: '2026-04-05T10:06:00Z'),
      ],
    );
  }

  @override
  Future<void> deleteConversation(String id) async {
    await _delay();
  }

  // ── Messaging (SSE) ─────────���─────────────────────────────────────────

  @override
  Stream<SseEvent> sendMessage(
    String conversationId,
    String content,
    String model, {
    CancelToken? cancelToken,
    Map<String, dynamic>? extra,
  }) async* {
    await _delay();
    const chunks = [
      'That\'s a ',
      'great question! ',
      'Let me think ',
      'about this...\n\n',
      'Based on your ',
      'previous conversations, ',
      'I\'d recommend ',
      'starting with the ',
      'simplest approach ',
      'and iterating from there.',
    ];
    for (final chunk in chunks) {
      await Future.delayed(const Duration(milliseconds: 50));
      yield SseChunk(chunk);
    }
    yield SseDone({
      'done': true,
      'message_id': 'demo-msg-${DateTime.now().millisecondsSinceEpoch}',
      'model': model,
      'memories_used': 3,
      'memory_ids': [101, 102, 103],
      'receipt': {
        'cost_usdc': 0.0012,
        'equivalent_direct_cost': 0.0035,
        'savings_pct': 65.7,
        'remaining_balance': 12.49,
      },
    });
  }

  @override
  Stream<SseEvent> sendGuestMessage(
    String content,
    List<Map<String, String>> history, {
    CancelToken? cancelToken,
  }) async* {
    await _delay();
    yield const SseChunk('I\'m running in guest mode. ');
    yield const SseChunk('Sign in to unlock persistent memory!');
    yield const SseDone({'done': true});
  }

  @override
  Stream<SseEvent> greet({CancelToken? cancelToken}) async* {
    await _delay();
    yield const SseChunk('Welcome back! ');
    yield const SseChunk('I remember our conversation about Flutter and Riverpod. ');
    yield const SseChunk('What would you like to explore today?');
    yield SseDone({
      'done': true,
      'meta': {
        'total_memories': 142,
        'memories_recalled': 5,
        'temporal_span': {'weeks': 4, 'since_label': 'Mar 9'},
        'topics': ['flutter', 'riverpod', 'solana', 'memory'],
        'greeting_cost': 0.0008,
      },
    });
  }

  // ── Memory ──────────────��─────────────────────────────────────────────

  @override
  Future<MemoryStats> getMemoryStats() async {
    await _delay();
    return const MemoryStats(
      total: 142,
      byType: {'episodic': 52, 'semantic': 45, 'procedural': 28, 'self_model': 17},
      avgImportance: 0.72,
      avgDecay: 0.84,
      topTags: [
        TagCount(tag: 'flutter', count: 18),
        TagCount(tag: 'solana', count: 12),
        TagCount(tag: 'riverpod', count: 9),
        TagCount(tag: 'memory', count: 7),
        TagCount(tag: 'architecture', count: 5),
      ],
    );
  }

  @override
  Future<List<MemorySummary>> getRecentMemories({int limit = 20, int offset = 0}) async {
    await _delay();
    final all = [
      const MemorySummary(id: 1, memoryType: 'episodic', summary: 'Discussed Riverpod state management patterns with user', importance: 0.85, createdAt: '2026-04-05T14:30:00Z', decay: 0.95),
      const MemorySummary(id: 2, memoryType: 'semantic', summary: 'Flutter uses Dart as its programming language with hot reload support', importance: 0.7, createdAt: '2026-04-04T11:00:00Z', decay: 0.88),
      const MemorySummary(id: 3, memoryType: 'procedural', summary: 'To create a new Flutter widget: extend StatelessWidget or StatefulWidget', importance: 0.6, createdAt: '2026-04-03T18:00:00Z', decay: 0.75),
      const MemorySummary(id: 4, memoryType: 'self_model', summary: 'User prefers concise code examples over lengthy explanations', importance: 0.9, createdAt: '2026-04-03T10:00:00Z', decay: 0.82),
      const MemorySummary(id: 5, memoryType: 'episodic', summary: 'Helped debug a Dio interceptor issue with auth token refresh', importance: 0.75, createdAt: '2026-04-02T09:30:00Z', decay: 0.65),
      const MemorySummary(id: 6, memoryType: 'semantic', summary: 'Solana transactions use base58 encoding for signatures', importance: 0.5, createdAt: '2026-04-01T15:00:00Z', decay: 0.55),
      const MemorySummary(id: 7, memoryType: 'procedural', summary: 'Run build_runner after modifying freezed models: dart run build_runner build', importance: 0.65, createdAt: '2026-03-31T12:00:00Z', decay: 0.42),
      const MemorySummary(id: 8, memoryType: 'episodic', summary: 'User asked about dream cycle optimization and memory consolidation', importance: 0.8, createdAt: '2026-03-30T16:00:00Z', decay: 0.38),
      const MemorySummary(id: 9, memoryType: 'semantic', summary: 'USDC is a stablecoin pegged to the US dollar on Solana and Base chains', importance: 0.45, createdAt: '2026-03-29T08:00:00Z', decay: 0.25),
      const MemorySummary(id: 10, memoryType: 'self_model', summary: 'I tend to over-explain when simpler answers would suffice', importance: 0.55, createdAt: '2026-03-28T14:00:00Z', decay: 0.18),
    ];
    return all.skip(offset).take(limit).toList();
  }

  @override
  Future<GraphData> getMemoryGraph({int limit = 200}) async {
    await _delay();
    return const GraphData(
      nodes: [
        GraphNode(id: 1, type: 'episodic', summary: 'Flutter discussion', importance: 0.85, decay: 0.95),
        GraphNode(id: 2, type: 'semantic', summary: 'Dart language', importance: 0.7, decay: 0.88),
        GraphNode(id: 3, type: 'procedural', summary: 'Widget creation', importance: 0.6, decay: 0.75),
        GraphNode(id: 4, type: 'self_model', summary: 'User preferences', importance: 0.9, decay: 0.82),
        GraphNode(id: 5, type: 'episodic', summary: 'Auth debugging', importance: 0.75, decay: 0.65),
        GraphNode(id: 6, type: 'semantic', summary: 'Solana basics', importance: 0.5, decay: 0.55),
        GraphNode(id: 7, type: 'procedural', summary: 'Build runner', importance: 0.65, decay: 0.42),
        GraphNode(id: 8, type: 'episodic', summary: 'Dream cycles', importance: 0.8, decay: 0.38),
      ],
      links: [
        GraphLink(sourceId: 1, targetId: 2, linkType: 'relates', strength: 0.8),
        GraphLink(sourceId: 1, targetId: 3, linkType: 'elaborates', strength: 0.6),
        GraphLink(sourceId: 2, targetId: 3, linkType: 'supports', strength: 0.5),
        GraphLink(sourceId: 4, targetId: 1, linkType: 'relates', strength: 0.7),
        GraphLink(sourceId: 5, targetId: 7, linkType: 'follows', strength: 0.4),
      ],
      total: 8,
    );
  }

  @override
  Future<List<GraphEntity>> getEntities() async {
    await _delay();
    return const [
      GraphEntity(id: 1, type: 'person', name: 'Jason', mentionCount: 15, lastSeen: '2026-04-05T14:30:00Z'),
      GraphEntity(id: 2, type: 'concept', name: 'Flutter', mentionCount: 18, lastSeen: '2026-04-05T10:00:00Z'),
      GraphEntity(id: 3, type: 'concept', name: 'Riverpod', mentionCount: 9, lastSeen: '2026-04-04T11:00:00Z'),
      GraphEntity(id: 4, type: 'project', name: 'Clude Bot', mentionCount: 12, lastSeen: '2026-04-03T18:00:00Z'),
      GraphEntity(id: 5, type: 'token', name: 'USDC', mentionCount: 7, lastSeen: '2026-04-01T15:00:00Z'),
      GraphEntity(id: 6, type: 'concept', name: 'Solana', mentionCount: 12, lastSeen: '2026-04-02T09:30:00Z'),
    ];
  }

  @override
  Future<List<GraphEntity>> searchEntities(String query) async {
    await _delay();
    final all = await getEntities();
    return all.where((e) => e.name.toLowerCase().contains(query.toLowerCase())).toList();
  }

  @override
  Future<EntityDetail> getEntityDetail(int id) async {
    await _delay();
    return const EntityDetail(
      entity: GraphEntity(id: 1, type: 'person', name: 'Jason', description: 'Primary user and developer', mentionCount: 15, lastSeen: '2026-04-05T14:30:00Z'),
      memories: [
        EntityMemory(id: 1, type: 'episodic', summary: 'Discussed Riverpod patterns with Jason', importance: 0.85, createdAt: '2026-04-05T14:30:00Z'),
        EntityMemory(id: 5, type: 'episodic', summary: 'Helped Jason debug auth interceptor', importance: 0.75, createdAt: '2026-04-02T09:30:00Z'),
      ],
      relatedEntities: [
        RelatedEntity(entityId: 2, cooccurrenceCount: 8, avgSalience: 0.7),
        RelatedEntity(entityId: 4, cooccurrenceCount: 5, avgSalience: 0.6),
      ],
    );
  }

  @override
  Future<ImportResult> importMemoryPack(Map<String, dynamic> pack) async {
    await _delay();
    return const ImportResult(imported: 5);
  }

  // ── Billing ─────��────────────────────────────────���────────────────────

  @override
  Future<Balance> getBalance() async {
    await _delay();
    return const Balance(balanceUsdc: 12.50, walletAddress: 'demo_wallet');
  }

  @override
  Future<TopupIntent> createTopupIntent(double amountUsdc, String chain) async {
    await _delay();
    return TopupIntent(
      id: 'demo-intent-001',
      walletAddress: 'demo_wallet',
      amountUsdc: amountUsdc,
      chain: chain,
      destAddress: '81MVTcY8iKQA3DMurbm8C3k8kCGySrsE575vyVVXiqFu',
      solanaPayUrl: 'solana:81MVTcY8iKQA3DMurbm8C3k8kCGySrsE575vyVVXiqFu?amount=$amountUsdc&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      reference: 'demo-ref-001',
    );
  }

  @override
  Future<TopupConfirmation> confirmTopup(String txHash, String intentId) async {
    await _delay();
    return const TopupConfirmation(status: 'confirmed', balanceUsdc: 22.50);
  }

  @override
  Future<TopupStatus> checkTopupStatus(String intentId) async {
    await _delay();
    return const TopupStatus(status: 'confirmed', amountUsdc: 10.0, balanceUsdc: 22.50);
  }

  @override
  Future<List<UsageRecord>> getUsageHistory() async {
    await _delay();
    return const [
      UsageRecord(date: '2026-04-05', promptTokens: 15200, completionTokens: 4800, costUsdc: 0.0031, conversationCount: 5),
      UsageRecord(date: '2026-04-04', promptTokens: 8400, completionTokens: 2600, costUsdc: 0.0018, conversationCount: 3),
      UsageRecord(date: '2026-04-03', promptTokens: 22000, completionTokens: 7100, costUsdc: 0.0045, conversationCount: 8),
      UsageRecord(date: '2026-04-02', promptTokens: 5600, completionTokens: 1800, costUsdc: 0.0011, conversationCount: 2),
      UsageRecord(date: '2026-04-01', promptTokens: 31000, completionTokens: 9500, costUsdc: 0.0062, conversationCount: 10),
    ];
  }

  @override
  Future<List<TopupRecord>> getTopupHistory() async {
    await _delay();
    return const [
      TopupRecord(id: 'tip-1', amountUsdc: 10.0, chain: 'solana', txHash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', status: 'confirmed', createdAt: '2026-04-03T14:22:00Z'),
      TopupRecord(id: 'tip-2', amountUsdc: 5.0, chain: 'base', txHash: null, status: 'pending', createdAt: '2026-04-05T10:00:00Z'),
      TopupRecord(id: 'tip-3', amountUsdc: 25.0, chain: 'solana', txHash: '2ZE7Rz4uxvGTkBCEMS5qrUfBdLcjPB3ocLi2fFB3CvD', status: 'confirmed', createdAt: '2026-03-28T09:15:00Z'),
    ];
  }

  // ── Agents ─────────��──────────────────────────────────────────────────

  @override
  Future<List<Agent>> listAgents() async {
    await _delay();
    return const [
      Agent(id: 'agent-1', name: 'Clude', description: 'Primary AI assistant', createdAt: '2026-01-01T00:00:00Z'),
      Agent(id: 'agent-2', name: 'Research Bot', description: 'Specialized research assistant', createdAt: '2026-02-15T00:00:00Z'),
    ];
  }
}
