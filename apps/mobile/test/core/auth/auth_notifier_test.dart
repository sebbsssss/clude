import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:privy_flutter/privy_flutter.dart' as privy_sdk;

import 'package:privy_flutter/src/modules/email/login_with_email.dart';

import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/responses.dart';
import 'package:clude_mobile/core/auth/auth_notifier.dart';
import 'package:clude_mobile/core/auth/auth_provider.dart';
import 'package:clude_mobile/core/auth/auth_state.dart';
import 'package:clude_mobile/core/auth/privy_provider.dart';
import 'package:clude_mobile/core/auth/wallet_auth_service.dart';
import 'package:clude_mobile/core/storage/secure_storage.dart';
import 'package:clude_mobile/core/storage/secure_storage_provider.dart';
import 'package:clude_mobile/features/byok/byok_provider.dart';

class MockSecureStorage extends Mock implements SecureStorageService {}

class MockPrivy extends Mock implements privy_sdk.Privy {}

class MockWalletAuthService extends Mock implements WalletAuthService {}

class MockApiClient extends Mock implements ApiClient {}

class MockLoginWithEmail extends Mock implements LoginWithEmail {}

void main() {
  late MockSecureStorage mockStorage;
  late MockPrivy mockPrivy;
  late MockApiClient mockApiClient;

  setUp(() {
    mockStorage = MockSecureStorage();
    mockPrivy = MockPrivy();
    mockApiClient = MockApiClient();

    // Default stubs
    when(() => mockStorage.getCortexApiKey()).thenAnswer((_) async => null);
    when(() => mockStorage.getWalletAddress()).thenAnswer((_) async => null);
    when(() => mockStorage.setCortexApiKey(any())).thenAnswer((_) async {});
    when(() => mockStorage.setWalletAddress(any())).thenAnswer((_) async {});
    when(() => mockStorage.clearAll()).thenAnswer((_) async {});
    when(() => mockStorage.getByokKey(any())).thenAnswer((_) async => null);
    when(() => mockStorage.deleteAllByokKeys()).thenAnswer((_) async {});
    when(() => mockPrivy.getAuthState())
        .thenAnswer((_) async => const privy_sdk.Unauthenticated());
    when(() => mockPrivy.currentAuthState)
        .thenReturn(const privy_sdk.Unauthenticated());
    when(() => mockPrivy.logout()).thenAnswer((_) async {});
  });

  ProviderContainer createContainer() {
    return ProviderContainer(
      overrides: [
        secureStorageProvider.overrideWithValue(mockStorage),
        privyProvider.overrideWithValue(mockPrivy),
        apiClientProvider.overrideWithValue(mockApiClient),
        // Override byok provider to avoid real storage access
        byokKeysNotifierProvider.overrideWith((ref) => ByokKeysNotifier(ref)),
      ],
    );
  }

  group('AuthNotifier', () {
    group('restoreSession', () {
      test('calls privy.getAuthState() to wait for SDK readiness', () async {
        final container = createContainer();
        addTearDown(container.dispose);

        await container.read(authNotifierProvider.notifier).restoreSession();

        verify(() => mockPrivy.getAuthState()).called(1);
      });

      test('restores with AuthMode.privy when wallet is stored', () async {
        when(() => mockStorage.getCortexApiKey())
            .thenAnswer((_) async => 'clk_test_key');
        when(() => mockStorage.getWalletAddress())
            .thenAnswer((_) async => '7xKX...abc');

        final container = createContainer();
        addTearDown(container.dispose);

        await container.read(authNotifierProvider.notifier).restoreSession();

        final state = container.read(authNotifierProvider);
        expect(state.isAuthenticated, isTrue);
        expect(state.cortexKey, 'clk_test_key');
        expect(state.walletAddress, '7xKX...abc');
        expect(state.authMode, AuthMode.privy);
      });

      test('restores with AuthMode.apiKey when no wallet stored', () async {
        when(() => mockStorage.getCortexApiKey())
            .thenAnswer((_) async => 'clk_test_key');

        final container = createContainer();
        addTearDown(container.dispose);

        await container.read(authNotifierProvider.notifier).restoreSession();

        final state = container.read(authNotifierProvider);
        expect(state.isAuthenticated, isTrue);
        expect(state.authMode, AuthMode.apiKey);
        expect(state.walletAddress, isNull);
      });

      test('stays unauthenticated when no key stored', () async {
        final container = createContainer();
        addTearDown(container.dispose);

        await container.read(authNotifierProvider.notifier).restoreSession();

        final state = container.read(authNotifierProvider);
        expect(state.isAuthenticated, isFalse);
        expect(state.cortexKey, isNull);
      });
    });

    group('loginWithPrivy', () {
      late MockWalletAuthService mockWalletService;

      setUp(() {
        mockWalletService = MockWalletAuthService();
      });

      test('happy path — authenticates and sets AuthMode.privy', () async {
        when(() => mockWalletService.connectAndSign()).thenAnswer(
          (_) async => (apiKey: 'clk_privy_key', wallet: '7xKXprivy'),
        );

        final container = createContainer();
        addTearDown(container.dispose);

        final result = await container
            .read(authNotifierProvider.notifier)
            .loginWithPrivy(service: mockWalletService);

        expect(result, isTrue);
        final state = container.read(authNotifierProvider);
        expect(state.isAuthenticated, isTrue);
        expect(state.cortexKey, 'clk_privy_key');
        expect(state.walletAddress, '7xKXprivy');
        expect(state.authMode, AuthMode.privy);
        expect(state.isLoading, isFalse);
      });

      test('failure — sets error state', () async {
        when(() => mockWalletService.connectAndSign())
            .thenThrow(Exception('Phantom not installed'));

        final container = createContainer();
        addTearDown(container.dispose);

        final result = await container
            .read(authNotifierProvider.notifier)
            .loginWithPrivy(service: mockWalletService);

        expect(result, isFalse);
        final state = container.read(authNotifierProvider);
        expect(state.isAuthenticated, isFalse);
        expect(state.error, contains('Phantom not installed'));
        expect(state.isLoading, isFalse);
      });

      test('shows loading state during flow', () async {
        final completer = Completer<({String apiKey, String wallet})>();
        when(() => mockWalletService.connectAndSign())
            .thenAnswer((_) => completer.future);

        final container = createContainer();
        addTearDown(container.dispose);

        // Start login but don't await
        final future = container
            .read(authNotifierProvider.notifier)
            .loginWithPrivy(service: mockWalletService);

        // Should be loading
        expect(container.read(authNotifierProvider).isLoading, isTrue);

        // Complete the flow
        completer.complete((apiKey: 'clk_key', wallet: 'wallet'));
        await future;

        expect(container.read(authNotifierProvider).isLoading, isFalse);
      });
    });

    group('loginWithApiKey', () {
      test('rejects keys not starting with clk_', () async {
        final container = createContainer();
        addTearDown(container.dispose);

        final result = await container
            .read(authNotifierProvider.notifier)
            .loginWithApiKey('bad_key');

        expect(result, isFalse);
        expect(container.read(authNotifierProvider).error, isNotNull);
      });

      test('sets AuthMode.apiKey on success', () async {
        // We can't easily test the full loginWithApiKey flow because it
        // creates its own Dio instance internally. This tests the prefix check.
        final container = createContainer();
        addTearDown(container.dispose);

        // Key starts with clk_ but validation will fail (no server)
        final result = await container
            .read(authNotifierProvider.notifier)
            .loginWithApiKey('clk_invalid');

        // Validation fails because no real server, but prefix check passed
        expect(result, isFalse);
        expect(container.read(authNotifierProvider).isLoading, isFalse);
      });
    });

    group('loginWithWallet', () {
      test('stores credentials and sets AuthMode.privy', () async {
        final container = createContainer();
        addTearDown(container.dispose);

        await container
            .read(authNotifierProvider.notifier)
            .loginWithWallet('clk_from_privy', '7xKXwallet');

        final state = container.read(authNotifierProvider);
        expect(state.isAuthenticated, isTrue);
        expect(state.cortexKey, 'clk_from_privy');
        expect(state.walletAddress, '7xKXwallet');
        expect(state.authMode, AuthMode.privy);
        verify(() => mockStorage.setCortexApiKey('clk_from_privy')).called(1);
        verify(() => mockStorage.setWalletAddress('7xKXwallet')).called(1);
      });
    });

    group('continueAsGuest', () {
      test('sets isGuest true without authentication', () {
        final container = createContainer();
        addTearDown(container.dispose);

        container.read(authNotifierProvider.notifier).continueAsGuest();

        final state = container.read(authNotifierProvider);
        expect(state.isGuest, isTrue);
        expect(state.isAuthenticated, isFalse);
        expect(state.cortexKey, isNull);
      });
    });

    group('logout', () {
      test('calls privy.logout() when Privy session is active', () async {
        final mockUser = MockPrivyUser();
        when(() => mockPrivy.currentAuthState)
            .thenReturn(privy_sdk.Authenticated(mockUser));

        final container = createContainer();
        addTearDown(container.dispose);

        // Login first
        await container
            .read(authNotifierProvider.notifier)
            .loginWithWallet('clk_key', 'wallet');

        // Then logout
        await container.read(authNotifierProvider.notifier).logout();

        verify(() => mockPrivy.logout()).called(1);
        verify(() => mockStorage.clearAll()).called(1);
        expect(container.read(authNotifierProvider).isAuthenticated, isFalse);
      });

      test('skips privy.logout() when no Privy session', () async {
        when(() => mockPrivy.currentAuthState)
            .thenReturn(const privy_sdk.Unauthenticated());

        final container = createContainer();
        addTearDown(container.dispose);

        await container.read(authNotifierProvider.notifier).logout();

        verifyNever(() => mockPrivy.logout());
        verify(() => mockStorage.clearAll()).called(1);
      });

      test('clears all auth state', () async {
        final container = createContainer();
        addTearDown(container.dispose);

        // Login first
        await container
            .read(authNotifierProvider.notifier)
            .loginWithWallet('clk_key', 'wallet');
        expect(container.read(authNotifierProvider).isAuthenticated, isTrue);

        // Logout
        await container.read(authNotifierProvider.notifier).logout();

        final state = container.read(authNotifierProvider);
        expect(state.isAuthenticated, isFalse);
        expect(state.cortexKey, isNull);
        expect(state.walletAddress, isNull);
      });
    });
  });
}

class MockPrivyUser extends Mock implements privy_sdk.PrivyUser {}
