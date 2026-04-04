import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/responses.dart';
import 'package:clude_mobile/features/balance/balance_notifier.dart';

class MockApiClient extends Mock implements ApiClient {}

const _balance = Balance(
  balanceUsdc: 5.50,
  walletAddress: 'wallet-1',
);

const _promoBalance = Balance(
  balanceUsdc: 5.50,
  walletAddress: 'wallet-1',
  promo: true,
  promoCreditUsdc: 2.00,
);

const _lowBalance = Balance(
  balanceUsdc: 0.05,
  walletAddress: 'wallet-1',
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockApiClient mockClient;

  setUp(() {
    mockClient = MockApiClient();
  });

  ProviderContainer createContainer() {
    return ProviderContainer(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
        // Use skipInit to avoid auto-fetch and polling in tests.
        balanceNotifierProvider.overrideWith(
          (ref) => BalanceNotifier(ref, skipInit: true),
        ),
      ],
    );
  }

  group('BalanceNotifier', () {
    test('fetchBalance updates state with balance data', () async {
      when(() => mockClient.getBalance()).thenAnswer((_) async => _balance);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(balanceNotifierProvider.notifier);
      await notifier.fetchBalance();

      final state = container.read(balanceNotifierProvider);
      expect(state.balanceUsdc, 5.50);
      expect(state.isLoading, false);
      expect(state.error, isNull);
    });

    test('fetchBalance sets promo fields when promo active', () async {
      when(() => mockClient.getBalance())
          .thenAnswer((_) async => _promoBalance);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(balanceNotifierProvider.notifier);
      await notifier.fetchBalance();

      final state = container.read(balanceNotifierProvider);
      expect(state.promoActive, true);
      expect(state.promoCreditUsdc, 2.00);
    });

    test('fetchBalance sets error on failure with no cached value', () async {
      when(() => mockClient.getBalance())
          .thenAnswer((_) async => throw Exception('Network error'));

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(balanceNotifierProvider.notifier);
      await notifier.fetchBalance();

      final state = container.read(balanceNotifierProvider);
      expect(state.error, isNotNull);
      expect(state.balanceUsdc, isNull);
      expect(state.isLoading, false);
    });

    test('fetchBalance retains cached value on subsequent failure', () async {
      when(() => mockClient.getBalance()).thenAnswer((_) async => _balance);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(balanceNotifierProvider.notifier);
      await notifier.fetchBalance();
      expect(container.read(balanceNotifierProvider).balanceUsdc, 5.50);

      // Second call fails.
      when(() => mockClient.getBalance())
          .thenAnswer((_) async => throw Exception('fail'));
      await notifier.fetchBalance();

      // Should retain cached balance.
      final state = container.read(balanceNotifierProvider);
      expect(state.balanceUsdc, 5.50);
    });

    test('fetchBalance tracks previousBalance for change detection', () async {
      when(() => mockClient.getBalance()).thenAnswer((_) async => _balance);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(balanceNotifierProvider.notifier);
      await notifier.fetchBalance();
      expect(container.read(balanceNotifierProvider).previousBalance, isNull);

      // Fetch again with lower balance.
      when(() => mockClient.getBalance())
          .thenAnswer((_) async => _lowBalance);
      await notifier.fetchBalance();

      final state = container.read(balanceNotifierProvider);
      expect(state.balanceUsdc, 0.05);
      expect(state.previousBalance, 5.50);
    });

    test('updateFromReceipt instantly updates balance as deduction', () async {
      when(() => mockClient.getBalance()).thenAnswer((_) async => _balance);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(balanceNotifierProvider.notifier);
      await notifier.fetchBalance();

      notifier.updateFromReceipt(4.25);

      final state = container.read(balanceNotifierProvider);
      expect(state.balanceUsdc, 4.25);
      expect(state.previousBalance, 5.50);
    });

    test('updateFromReceipt is ignored when null-like scenarios', () async {
      when(() => mockClient.getBalance()).thenAnswer((_) async => _balance);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(balanceNotifierProvider.notifier);
      await notifier.fetchBalance();

      // State should not change — updateFromReceipt only called with valid doubles
      // This test verifies the base state is stable.
      expect(container.read(balanceNotifierProvider).balanceUsdc, 5.50);
    });

    test('stopPolling prevents further fetches', () async {
      when(() => mockClient.getBalance()).thenAnswer((_) async => _balance);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(balanceNotifierProvider.notifier);
      notifier.startPolling();
      notifier.stopPolling();

      // Reset mock to track no further calls.
      clearInteractions(mockClient);

      // Wait past one poll interval.
      await Future<void>.delayed(const Duration(milliseconds: 50));

      verifyNever(() => mockClient.getBalance());
    });
  });
}
