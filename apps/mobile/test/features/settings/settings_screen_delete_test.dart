import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
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

  void setState(AuthState s) => state = s;
}

void main() {
  group('SettingsScreen — Delete Account dialog', () {
    late MockSecureStorage mockStorage;
    late MockAuthNotifier mockNotifier;

    setUp(() {
      mockStorage = MockSecureStorage();
      when(() => mockStorage.getSelectedAgentId()).thenAnswer((_) async => '1');
      when(() => mockStorage.setSelectedAgentId(any())).thenAnswer((_) async {});
      when(() => mockStorage.getByokKey(any())).thenAnswer((_) async => null);

      mockNotifier = MockAuthNotifier();
    });

    Widget buildSubject() {
      final router = GoRouter(
        initialLocation: '/settings',
        routes: [
          GoRoute(
              path: '/settings', builder: (_, _) => const SettingsScreen()),
          GoRoute(
              path: '/login',
              builder: (_, _) =>
                  const Scaffold(body: Center(child: Text('LOGIN_SCREEN')))),
        ],
      );

      return ProviderScope(
        overrides: [
          agentsProvider.overrideWith((ref) async =>
              [const Agent(id: '1', name: 'Alpha', createdAt: '2026-01-01')]),
          secureStorageProvider.overrideWithValue(mockStorage),
          authNotifierProvider.overrideWith((ref) => mockNotifier),
        ],
        child: MaterialApp.router(routerConfig: router),
      );
    }

    Future<void> openDialog(WidgetTester tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();
      // Delete Account button lives near the bottom of a ListView — scroll to it.
      await tester.scrollUntilVisible(
        find.text('Delete Account'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('Delete Account'));
      await tester.pumpAndSettle();
    }

    Finder dialogButton(String label) => find.descendant(
          of: find.byType(AlertDialog),
          matching: find.widgetWithText(TextButton, label),
        );

    testWidgets('cancel closes dialog without calling deleteAccount',
        (tester) async {
      await openDialog(tester);
      await tester.tap(dialogButton('Cancel'));
      await tester.pumpAndSettle();

      verifyNever(() => mockNotifier.deleteAccount());
      expect(find.byType(AlertDialog), findsNothing);
    });

    testWidgets('confirm → success: closes dialog, calls logout, navigates',
        (tester) async {
      when(() => mockNotifier.deleteAccount())
          .thenAnswer((_) async => true);
      when(() => mockNotifier.logout()).thenAnswer((_) async {
        mockNotifier.setState(const AuthState());
      });

      await openDialog(tester);
      await tester.tap(dialogButton('Delete Account'));
      await tester.pumpAndSettle();

      verify(() => mockNotifier.deleteAccount()).called(1);
      verify(() => mockNotifier.logout()).called(1);
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text('LOGIN_SCREEN'), findsOneWidget);
    });

    testWidgets('confirm → failure: closes dialog and shows SnackBar with error',
        (tester) async {
      when(() => mockNotifier.deleteAccount()).thenAnswer((_) async {
        mockNotifier.setState(
          const AuthState(
            isAuthenticated: true,
            cortexKey: 'clk_test1234abcd1a3f',
            error: 'Server unreachable',
          ),
        );
        return false;
      });

      await openDialog(tester);
      await tester.tap(dialogButton('Delete Account'));
      await tester.pumpAndSettle();

      verify(() => mockNotifier.deleteAccount()).called(1);
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text('Server unreachable'), findsOneWidget);
      expect(find.text('LOGIN_SCREEN'), findsNothing);
    });
  });
}
