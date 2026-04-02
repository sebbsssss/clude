import 'package:flutter_test/flutter_test.dart';
import 'package:clude_mobile/core/api/models/agent.dart';

void main() {
  group('Agent', () {
    test('fromJson parses correctly', () {
      final json = {
        'id': 'agent-abc-123',
        'name': 'My Agent',
        'description': 'A test agent',
        'created_at': '2026-03-15T10:30:00Z',
      };

      final agent = Agent.fromJson(json);

      expect(agent.id, 'agent-abc-123');
      expect(agent.name, 'My Agent');
      expect(agent.description, 'A test agent');
      expect(agent.createdAt, '2026-03-15T10:30:00Z');
    });

    test('fromJson handles null description', () {
      final json = {
        'id': 'agent-xyz',
        'name': 'Default',
        'created_at': '2026-01-01T00:00:00Z',
      };

      final agent = Agent.fromJson(json);

      expect(agent.id, 'agent-xyz');
      expect(agent.description, isNull);
    });

    test('toJson produces correct output', () {
      const agent = Agent(
        id: 'agent-1',
        name: 'Test',
        createdAt: '2026-01-01T00:00:00Z',
      );

      final json = agent.toJson();

      expect(json['id'], 'agent-1');
      expect(json['name'], 'Test');
      expect(json['created_at'], '2026-01-01T00:00:00Z');
      expect(json.containsKey('description'), true);
      expect(json['description'], isNull);
    });

    test('equality works via freezed', () {
      const a = Agent(id: '1', name: 'A', createdAt: '2026-01-01');
      const b = Agent(id: '1', name: 'A', createdAt: '2026-01-01');
      const c = Agent(id: '2', name: 'B', createdAt: '2026-01-02');

      expect(a, equals(b));
      expect(a, isNot(equals(c)));
    });
  });
}
