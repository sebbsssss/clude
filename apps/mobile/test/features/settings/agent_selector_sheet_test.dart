import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/models/agent.dart';
import 'package:clude_mobile/core/storage/secure_storage.dart';
import 'package:clude_mobile/core/storage/secure_storage_provider.dart';
import 'package:clude_mobile/features/settings/agent_selector_sheet.dart';
import 'package:clude_mobile/features/settings/agents_provider.dart';

class MockSecureStorage extends Mock implements SecureStorageService {}

void main() {
  group('AgentSelectorSheet', () {
    final testAgents = [
      const Agent(id: '1', name: 'Alpha Agent', createdAt: '2026-01-01'),
      const Agent(id: '2', name: 'Beta Agent', createdAt: '2026-02-01'),
    ];

    Widget buildSubject({
      required List<Agent> agents,
      String? selectedAgentId,
    }) {
      final mockStorage = MockSecureStorage();
      when(() => mockStorage.getSelectedAgentId())
          .thenAnswer((_) async => selectedAgentId);
      when(() => mockStorage.setSelectedAgentId(any()))
          .thenAnswer((_) async {});

      return ProviderScope(
        overrides: [
          agentsProvider.overrideWith((ref) async => agents),
          secureStorageProvider.overrideWithValue(mockStorage),
        ],
        child: const MaterialApp(
          home: Scaffold(body: AgentSelectorSheet()),
        ),
      );
    }

    testWidgets('shows all agents', (tester) async {
      await tester.pumpWidget(buildSubject(
        agents: testAgents,
        selectedAgentId: '1',
      ));
      await tester.pumpAndSettle();

      expect(find.text('Alpha Agent'), findsOneWidget);
      expect(find.text('Beta Agent'), findsOneWidget);
    });

    testWidgets('shows checkmark on selected agent', (tester) async {
      await tester.pumpWidget(buildSubject(
        agents: testAgents,
        selectedAgentId: '1',
      ));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.check), findsOneWidget);
    });

    testWidgets('shows agent ID truncated', (tester) async {
      await tester.pumpWidget(buildSubject(
        agents: [
          const Agent(
            id: 'agent-very-long-id-12345',
            name: 'Test',
            createdAt: '2026-01-01',
          ),
        ],
        selectedAgentId: null,
      ));
      await tester.pumpAndSettle();

      // ID + creation date shown in subtitle
      expect(find.textContaining('agent-'), findsOneWidget);
      expect(find.textContaining('2026-01-01'), findsOneWidget);
    });

    testWidgets('shows loading indicator while loading', (tester) async {
      final mockStorage = MockSecureStorage();
      when(() => mockStorage.getSelectedAgentId())
          .thenAnswer((_) async => null);

      // Use a Completer that never completes to simulate loading state
      final completer = Completer<List<Agent>>();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            agentsProvider.overrideWith((ref) => completer.future),
            secureStorageProvider.overrideWithValue(mockStorage),
          ],
          child: const MaterialApp(
            home: Scaffold(body: AgentSelectorSheet()),
          ),
        ),
      );
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // Complete to avoid pending future warnings
      completer.complete(testAgents);
    });
  });
}
