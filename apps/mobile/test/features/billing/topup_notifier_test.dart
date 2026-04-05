import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/responses.dart';
import 'package:clude_mobile/features/balance/balance_notifier.dart';
import 'package:clude_mobile/features/billing/topup_notifier.dart';
import 'package:clude_mobile/features/billing/topup_state.dart';

class MockApiClient extends Mock implements ApiClient {}

const _validIntent = TopupIntent(
  id: 'intent-1',
  walletAddress: 'wallet-1',
  amountUsdc: 10.0,
  chain: 'solana',
  destAddress: '81MVTcY8iKQA3DMurbm8C3k8kCGySrsE575vyVVXiqFu',
  solanaPayUrl: 'solana:pay-url',
);

const _mismatchIntent = TopupIntent(
  id: 'intent-2',
  walletAddress: 'wallet-1',
  amountUsdc: 10.0,
  chain: 'solana',
  destAddress: 'WRONG_ADDRESS',
);

const _baseIntent = TopupIntent(
  id: 'intent-3',
  walletAddress: 'wallet-1',
  amountUsdc: 10.0,
  chain: 'base',
  destAddress: '81MVTcY8iKQA3DMurbm8C3k8kCGySrsE575vyVVXiqFu',
);

const _confirmedStatus = TopupStatus(
  status: 'confirmed',
  amountUsdc: 10.0,
  balanceUsdc: 15.50,
);

const _pendingStatus = TopupStatus(status: 'pending');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockApiClient mockClient;

  setUp(() {
    mockClient = MockApiClient();
    when(() => mockClient.getBalance()).thenAnswer(
      (_) async => const Balance(balanceUsdc: 15.50, walletAddress: 'w'),
    );
  });

  ProviderContainer createContainer() {
    return ProviderContainer(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
        balanceNotifierProvider.overrideWith(
          (ref) => BalanceNotifier(ref, skipInit: true),
        ),
      ],
    );
  }

  group('TopupNotifier', () {
    test('starts in idle state', () {
      final container = createContainer();
      addTearDown(container.dispose);

      expect(container.read(topupNotifierProvider), const TopupState.idle());
    });

    test('createIntent sets awaitingPayment on valid Solana intent',
        () async {
      when(() => mockClient.createTopupIntent(10.0, 'solana'))
          .thenAnswer((_) async => _validIntent);
      when(() => mockClient.checkTopupStatus('intent-1'))
          .thenAnswer((_) async => _pendingStatus);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(topupNotifierProvider.notifier);
      await notifier.createIntent(10.0, 'solana');

      final state = container.read(topupNotifierProvider);
      expect(state, isA<TopupAwaitingPayment>());
      final awaiting = state as TopupAwaitingPayment;
      expect(awaiting.intentId, 'intent-1');
      expect(awaiting.solanaPayUrl, 'solana:pay-url');
      expect(awaiting.chain, 'solana');
    });

    test('createIntent shows error on treasury mismatch', () async {
      when(() => mockClient.createTopupIntent(10.0, 'solana'))
          .thenAnswer((_) async => _mismatchIntent);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(topupNotifierProvider.notifier);
      await notifier.createIntent(10.0, 'solana');

      final state = container.read(topupNotifierProvider);
      expect(state, isA<TopupError>());
      expect(
        (state as TopupError).message,
        contains('destination mismatch'),
      );
    });

    test('createIntent shows error on API failure', () async {
      when(() => mockClient.createTopupIntent(10.0, 'solana'))
          .thenAnswer((_) async => throw Exception('Network error'));

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(topupNotifierProvider.notifier);
      await notifier.createIntent(10.0, 'solana');

      final state = container.read(topupNotifierProvider);
      expect(state, isA<TopupError>());
    });

    test('createIntent sets awaitingPayment for Base chain', () async {
      when(() => mockClient.createTopupIntent(10.0, 'base'))
          .thenAnswer((_) async => _baseIntent);
      when(() => mockClient.checkTopupStatus('intent-3'))
          .thenAnswer((_) async => _pendingStatus);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(topupNotifierProvider.notifier);
      await notifier.createIntent(10.0, 'base');

      final state = container.read(topupNotifierProvider);
      expect(state, isA<TopupAwaitingPayment>());
      expect((state as TopupAwaitingPayment).chain, 'base');
    });

    test('polling transitions to confirmed when status is confirmed',
        () async {
      when(() => mockClient.createTopupIntent(10.0, 'solana'))
          .thenAnswer((_) async => _validIntent);
      // First poll returns pending, second returns confirmed.
      var pollCount = 0;
      when(() => mockClient.checkTopupStatus('intent-1')).thenAnswer((_) async {
        pollCount++;
        return pollCount >= 2 ? _confirmedStatus : _pendingStatus;
      });

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(topupNotifierProvider.notifier);
      await notifier.createIntent(10.0, 'solana');

      // Wait for 2 poll cycles (3s each).
      await Future<void>.delayed(const Duration(seconds: 7));

      final state = container.read(topupNotifierProvider);
      expect(state, isA<TopupConfirmed>());
      expect((state as TopupConfirmed).newBalance, 15.50);
    });

    test('cancelPolling stops polling and resets to idle', () async {
      when(() => mockClient.createTopupIntent(10.0, 'solana'))
          .thenAnswer((_) async => _validIntent);
      when(() => mockClient.checkTopupStatus('intent-1'))
          .thenAnswer((_) async => _pendingStatus);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(topupNotifierProvider.notifier);
      await notifier.createIntent(10.0, 'solana');

      expect(container.read(topupNotifierProvider), isA<TopupAwaitingPayment>());

      notifier.cancelPolling();

      expect(container.read(topupNotifierProvider), const TopupState.idle());
    });

    test('confirmBase calls confirmTopup and sets confirmed', () async {
      when(() => mockClient.confirmTopup('tx-hash', 'intent-3'))
          .thenAnswer((_) async => const TopupConfirmation(
                status: 'confirmed',
                balanceUsdc: 20.0,
              ));

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(topupNotifierProvider.notifier);
      await notifier.confirmBase('intent-3', 'tx-hash');

      final state = container.read(topupNotifierProvider);
      expect(state, isA<TopupConfirmed>());
      expect((state as TopupConfirmed).newBalance, 20.0);
    });

    test('confirmBase shows error on failure', () async {
      when(() => mockClient.confirmTopup('tx-hash', 'intent-3'))
          .thenAnswer((_) async => throw Exception('Invalid tx'));

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(topupNotifierProvider.notifier);
      await notifier.confirmBase('intent-3', 'tx-hash');

      expect(container.read(topupNotifierProvider), isA<TopupError>());
    });

    test('reset returns to idle', () async {
      when(() => mockClient.createTopupIntent(10.0, 'solana'))
          .thenAnswer((_) async => throw Exception('fail'));

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(topupNotifierProvider.notifier);
      await notifier.createIntent(10.0, 'solana');
      expect(container.read(topupNotifierProvider), isA<TopupError>());

      notifier.reset();
      expect(container.read(topupNotifierProvider), const TopupState.idle());
    });
  });
}
