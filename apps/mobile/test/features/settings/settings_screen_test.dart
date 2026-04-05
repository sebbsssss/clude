import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/models/agent.dart';
import 'package:clude_mobile/core/auth/auth_notifier.dart';
import 'package:clude_mobile/core/auth/auth_provider.dart';
import 'package:clude_mobile/core/auth/auth_state.dart';
import 'package:clude_mobile/core/storage/secure_storage.dart';
import 'package:clude_mobile/core/storage/secure_storage_provider.dart';
import 'package:clude_mobile/features/settings/agents_provider.dart';
import 'package:clude_mobile/features/settings/settings_screen.dart';

class MockSecureStorage extends Mock implements SecureStorageService {}

class MockAuthNotifier extends StateNotifier<AuthState>
    with Mock
    implements AuthNotifier {
  MockAuthNotifier()
      : super(const AuthState(
          isAuthenticated: true,
          cortexKey: 'clk_test1234abcd1a3f',
          walletAddress: '7xKpG8mN4w',
        ));
}

void main() {
  group('SettingsScreen', () {
    final multipleAgents = [
      const Agent(id: '1', name: 'Alpha', createdAt: '2026-01-01'),
      const Agent(id: '2', name: 'Beta', createdAt: '2026-02-01'),
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
          authNotifierProvider.overrideWith((ref) => MockAuthNotifier()),
        ],
        child: const MaterialApp(home: SettingsScreen()),
      );
    }

    testWidgets('shows agent section when multiple agents', (tester) async {
      await tester.pumpWidget(buildSubject(
        agents: multipleAgents,
        selectedAgentId: '1',
      ));
      await tester.pumpAndSettle();

      expect(find.text('AGENT'), findsOneWidget);
      expect(find.text('Alpha'), findsOneWidget);
    });

    testWidgets('hides agent section when single agent', (tester) async {
      await tester.pumpWidget(buildSubject(
        agents: [const Agent(id: '1', name: 'Solo', createdAt: '2026-01-01')],
        selectedAgentId: '1',
      ));
      await tester.pumpAndSettle();

      expect(find.text('AGENT'), findsNothing);
    });

    testWidgets('tapping agent section opens bottom sheet', (tester) async {
      await tester.pumpWidget(buildSubject(
        agents: multipleAgents,
        selectedAgentId: '1',
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Alpha'));
      await tester.pumpAndSettle();

      // Bottom sheet should show both agents
      expect(find.text('Beta'), findsWidgets);
    });
  });
}
