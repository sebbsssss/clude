import 'package:flutter_test/flutter_test.dart';
import 'package:clude_mobile/core/api/demo_api_client.dart';
import 'package:clude_mobile/core/api/sse_parser.dart';

void main() {
  late DemoApiClient client;

  setUp(() {
    client = DemoApiClient();
  });

  group('DemoApiClient', () {
    test('validateKey returns true', () async {
      expect(await client.validateKey(), true);
    });

    test('listConversations returns non-empty list', () async {
      final convos = await client.listConversations();
      expect(convos.isNotEmpty, true);
      expect(convos.first.title, isNotNull);
    });

    test('getMemoryStats returns valid stats', () async {
      final stats = await client.getMemoryStats();
      expect(stats.total, greaterThan(0));
      expect(stats.avgImportance, greaterThan(0));
      expect(stats.avgDecay, greaterThan(0));
      expect(stats.byType.isNotEmpty, true);
    });

    test('sendMessage returns stream with done event', () async {
      final events = await client
          .sendMessage('conv-1', 'Hello', 'gpt-4o')
          .toList();
      expect(events.isNotEmpty, true);
      expect(events.last, isA<SseDone>());
      expect(events.whereType<SseChunk>().isNotEmpty, true);
    });

    test('getBalance returns positive balance', () async {
      final balance = await client.getBalance();
      expect(balance.balanceUsdc, greaterThan(0));
    });
  });
}
