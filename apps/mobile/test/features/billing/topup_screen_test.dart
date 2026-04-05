import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/responses.dart';
import 'package:clude_mobile/features/balance/balance_notifier.dart';
import 'package:clude_mobile/features/billing/topup_notifier.dart';
import 'package:clude_mobile/features/billing/topup_screen.dart';
import 'package:clude_mobile/features/billing/topup_state.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockClient;

  setUp(() {
    mockClient = MockApiClient();
  });

  Widget buildSubject({TopupState? initialState}) {
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
        balanceNotifierProvider.overrideWith(
          (ref) => BalanceNotifier(ref, skipInit: true),
        ),
        if (initialState != null)
          topupNotifierProvider.overrideWith(
            (ref) => TopupNotifier(ref)..setStateForTest(initialState),
          ),
      ],
      child: const MaterialApp(home: TopUpScreen()),
    );
  }

  group('TopUpScreen', () {
    testWidgets('shows preset amount buttons', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('\$5'), findsOneWidget);
      expect(find.text('\$10'), findsOneWidget);
      expect(find.text('\$25'), findsOneWidget);
      expect(find.text('\$50'), findsOneWidget);
    });

    testWidgets('shows chain selector with Solana default', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Solana'), findsOneWidget);
      expect(find.text('Base'), findsOneWidget);
    });

    testWidgets('CTA disabled when no amount selected', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Find the CTA button — should be disabled initially.
      final cta = find.widgetWithText(ElevatedButton, 'Pay with Wallet');
      expect(cta, findsOneWidget);

      final button = tester.widget<ElevatedButton>(cta);
      expect(button.onPressed, isNull);
    });

    testWidgets('selecting preset amount enables CTA', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('\$10'));
      await tester.pumpAndSettle();

      final cta = find.widgetWithText(ElevatedButton, 'Pay with Wallet');
      final button = tester.widget<ElevatedButton>(cta);
      expect(button.onPressed, isNotNull);
    });

    testWidgets('custom amount below 1 shows minimum error', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), '0.50');
      await tester.pumpAndSettle();

      expect(find.text('Minimum \$1.00'), findsOneWidget);
    });

    testWidgets('shows awaiting payment with QR for Solana', (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const TopupState.awaitingPayment(
          intentId: 'intent-1',
          destAddress: 'treasury',
          solanaPayUrl: 'solana:pay-url',
          chain: 'solana',
        ),
      ));
      await tester.pump();
      await tester.pump();

      expect(find.text('Waiting for payment...'), findsOneWidget);
      expect(find.text('Cancel'), findsOneWidget);
    });

    testWidgets('shows dest address and tx hash input for Base',
        (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const TopupState.awaitingPayment(
          intentId: 'intent-3',
          destAddress: 'treasury-addr',
          chain: 'base',
        ),
      ));
      await tester.pump();
      await tester.pump();

      expect(find.text('treasury-addr'), findsOneWidget);
      expect(find.text('Transaction Hash'), findsOneWidget);
      expect(find.text('Confirm Payment'), findsOneWidget);
    });

    testWidgets('shows success state with balance', (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const TopupState.confirmed(newBalance: 15.50),
      ));
      await tester.pump();
      await tester.pump();

      expect(find.text('\$15.50'), findsOneWidget);

      // Pump past the 2s auto-navigate timer to avoid pending timer error.
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('shows error state with retry', (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const TopupState.error(
            message: 'Payment destination mismatch — contact support'),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Payment destination mismatch — contact support'),
          findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('shows timeout message', (tester) async {
      await tester.pumpWidget(buildSubject(
        initialState: const TopupState.timedOut(),
      ));
      await tester.pumpAndSettle();

      expect(find.textContaining('not detected'), findsOneWidget);
    });
  });
}
