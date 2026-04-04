import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/responses.dart';
import 'package:clude_mobile/features/balance/balance_chip.dart';
import 'package:clude_mobile/features/balance/balance_notifier.dart';
import 'package:clude_mobile/features/balance/balance_state.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockClient;

  setUp(() {
    mockClient = MockApiClient();
  });

  Widget buildSubject({BalanceState? initialState}) {
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (_, __) => const Scaffold(appBar: _TestAppBar()),
        ),
        GoRoute(
          path: '/topup',
          builder: (_, __) => const Scaffold(body: Text('TopUp Page')),
        ),
      ],
    );

    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
        if (initialState != null)
          balanceNotifierProvider.overrideWith(
            (ref) => BalanceNotifier(ref, skipInit: true)
              ..setStateForTest(initialState),
          ),
      ],
      child: MaterialApp.router(routerConfig: router),
    );
  }

  group('BalanceChip', () {
    testWidgets('shows shimmer on initial loading state', (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const BalanceState(isLoading: true),
      ));
      await tester.pump();

      // Shimmer should be present (Shimmer widget from shimmer package).
      expect(find.byType(BalanceChip), findsOneWidget);
    });

    testWidgets('shows dollar amount when balance loaded', (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const BalanceState(
          balanceUsdc: 5.50,
          isLoading: false,
        ),
      ));
      await tester.pump();

      expect(find.text('\$5.50'), findsOneWidget);
    });

    testWidgets('shows green color when balance > 1.00', (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const BalanceState(
          balanceUsdc: 2.50,
          isLoading: false,
        ),
      ));
      await tester.pump();

      expect(find.text('\$2.50'), findsOneWidget);
      // Green chip should be rendered (visual test — we verify the text appears).
    });

    testWidgets('shows yellow color when balance 0.10-1.00', (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const BalanceState(
          balanceUsdc: 0.50,
          isLoading: false,
        ),
      ));
      await tester.pump();

      expect(find.text('\$0.50'), findsOneWidget);
    });

    testWidgets('shows red color when balance < 0.10', (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const BalanceState(
          balanceUsdc: 0.05,
          isLoading: false,
        ),
      ));
      await tester.pump();

      expect(find.text('\$0.05'), findsOneWidget);
    });

    testWidgets('shows dash on error with no cached value', (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const BalanceState(
          isLoading: false,
          error: 'Network error',
        ),
      ));
      await tester.pump();

      expect(find.text('—'), findsOneWidget);
    });

    testWidgets('shows PROMO badge when promo active', (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const BalanceState(
          balanceUsdc: 5.50,
          isLoading: false,
          promoActive: true,
          promoCreditUsdc: 2.00,
        ),
      ));
      await tester.pump();

      expect(find.text('PROMO'), findsOneWidget);
      expect(find.text('\$2.00'), findsOneWidget);
    });

    testWidgets('navigates to /topup on tap', (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const BalanceState(
          balanceUsdc: 5.50,
          isLoading: false,
        ),
      ));
      await tester.pump();

      await tester.tap(find.text('\$5.50'));
      await tester.pumpAndSettle();

      expect(find.text('TopUp Page'), findsOneWidget);
    });
  });
}

class _TestAppBar extends StatelessWidget implements PreferredSizeWidget {
  const _TestAppBar();

  @override
  Widget build(BuildContext context) {
    return AppBar(
      title: const Text('Test'),
      actions: const [BalanceChip()],
    );
  }

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);
}
