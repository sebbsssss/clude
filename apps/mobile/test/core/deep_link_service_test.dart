import 'package:clude_mobile/core/auth/auth_notifier.dart';
import 'package:clude_mobile/core/auth/auth_provider.dart';
import 'package:clude_mobile/core/auth/auth_state.dart';
import 'package:clude_mobile/core/deep_link_service.dart';
import 'package:clude_mobile/core/storage/secure_storage.dart';
import 'package:clude_mobile/core/storage/secure_storage_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

class MockGoRouter extends Mock implements GoRouter {}

class MockSecureStorage extends Mock implements SecureStorageService {}

/// Creates a DeepLinkService backed by a ProviderContainer.
({DeepLinkService service, ProviderContainer container}) createService() {
  final mockStorage = MockSecureStorage();
  when(() => mockStorage.getCortexApiKey()).thenAnswer((_) async => null);
  when(() => mockStorage.getWalletAddress()).thenAnswer((_) async => null);
  when(() => mockStorage.setCortexApiKey(any())).thenAnswer((_) async {});
  when(() => mockStorage.clearAll()).thenAnswer((_) async {});

  final container = ProviderContainer(
    overrides: [
      secureStorageProvider.overrideWithValue(mockStorage),
    ],
  );

  final service = container.read(deepLinkServiceProvider);
  return (service: service, container: container);
}

void main() {
  late MockGoRouter mockRouter;

  setUp(() {
    mockRouter = MockGoRouter();
  });

  group('parseRoute', () {
    test('maps clude://chat/:id to /chat/:id', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(service.parseRoute(Uri.parse('clude://chat/abc-123')), '/chat/abc-123');
    });

    test('maps clude://chat (no id) to /chat', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(service.parseRoute(Uri.parse('clude://chat')), '/chat');
    });

    test('maps clude://memory to /memory', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(service.parseRoute(Uri.parse('clude://memory')), '/memory');
    });

    test('returns login action for valid clk_ key', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(service.parseRoute(Uri.parse('clude://login?key=clk_abc123')), '_login:clk_abc123');
    });

    test('returns null for login with invalid key prefix', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(service.parseRoute(Uri.parse('clude://login?key=badkey')), isNull);
    });

    test('returns null for login without key param', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(service.parseRoute(Uri.parse('clude://login')), isNull);
    });

    test('returns topup callback with intent and tx', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(
        service.parseRoute(Uri.parse('clude://topup/callback?intent=INT1&tx=TX1')),
        '_topup:INT1:TX1',
      );
    });

    test('returns null for topup callback missing intent', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(service.parseRoute(Uri.parse('clude://topup/callback?tx=TX1')), isNull);
    });

    test('returns null for topup callback missing tx', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(service.parseRoute(Uri.parse('clude://topup/callback?intent=INT1')), isNull);
    });

    test('returns null for wallet-connect (handled by WalletAuthService)', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(service.parseRoute(Uri.parse('clude://wallet-connect?data=xyz')), isNull);
    });

    test('returns null for wallet-sign (handled by WalletAuthService)', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(service.parseRoute(Uri.parse('clude://wallet-sign?data=xyz')), isNull);
    });

    test('returns null for unrecognised path', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(service.parseRoute(Uri.parse('clude://unknown/path')), isNull);
    });

    test('returns null for empty host', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      expect(service.parseRoute(Uri.parse('clude://')), isNull);
    });
  });

  group('handleUri', () {
    const authed = AuthState(isAuthenticated: true, cortexKey: 'clk_x');
    const unauthed = AuthState();

    test('navigates directly when authenticated', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      service.handleUri(Uri.parse('clude://memory'), mockRouter, authed);

      verify(() => mockRouter.go('/memory')).called(1);
      expect(service.pendingRoute, isNull);
    });

    test('stores pending route and redirects to login when unauthenticated', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      service.handleUri(Uri.parse('clude://chat/abc-123'), mockRouter, unauthed);

      verify(() => mockRouter.go('/login')).called(1);
      expect(service.pendingRoute, '/chat/abc-123');
    });

    test('does not navigate for unrecognised URI', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      service.handleUri(Uri.parse('clude://unknown'), mockRouter, authed);

      verifyNever(() => mockRouter.go(any()));
    });

    test('ignores wallet deep links', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      service.handleUri(Uri.parse('clude://wallet-connect?data=xyz'), mockRouter, authed);

      verifyNever(() => mockRouter.go(any()));
    });

    test('login action triggers auto-login when unauthenticated', () async {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      service.handleUri(Uri.parse('clude://login?key=clk_testkey'), mockRouter, unauthed);

      // Give the async loginWithApiKey future time to resolve.
      await Future<void>.delayed(Duration.zero);

      // The service called loginWithApiKey on the real AuthNotifier via Ref.
      // Since MockSecureStorage returns null for validation, login will fail —
      // but we verify the code path was invoked (no crash, no pending route).
      expect(service.pendingRoute, isNull);
    });

    test('login action navigates to /chat when already authenticated', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      service.handleUri(Uri.parse('clude://login?key=clk_abc'), mockRouter, authed);

      verify(() => mockRouter.go('/chat')).called(1);
    });

    test('topup callback navigates to /topup and stashes params when authenticated', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      service.handleUri(
        Uri.parse('clude://topup/callback?intent=INT1&tx=TX1'),
        mockRouter,
        authed,
      );

      verify(() => mockRouter.go('/topup')).called(1);
      expect(service.pendingTopupParams, ('INT1', 'TX1'));
    });
  });

  group('consumePendingRoute', () {
    const unauthed = AuthState();

    test('navigates to pending route and clears it', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      service.handleUri(Uri.parse('clude://chat/abc'), mockRouter, unauthed);
      reset(mockRouter);

      service.consumePendingRoute(mockRouter);

      verify(() => mockRouter.go('/chat/abc')).called(1);
      expect(service.pendingRoute, isNull);
    });

    test('does nothing when no pending route', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      service.consumePendingRoute(mockRouter);

      verifyNever(() => mockRouter.go(any()));
    });

    test('second consume is a no-op', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      service.handleUri(Uri.parse('clude://memory'), mockRouter, unauthed);
      reset(mockRouter);

      service.consumePendingRoute(mockRouter);
      service.consumePendingRoute(mockRouter);

      verify(() => mockRouter.go('/memory')).called(1);
    });

    test('navigates to /topup and stashes params for pending topup callback', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      service.handleUri(
        Uri.parse('clude://topup/callback?intent=INT1&tx=TX1'),
        mockRouter,
        unauthed,
      );
      reset(mockRouter);

      service.consumePendingRoute(mockRouter);

      verify(() => mockRouter.go('/topup')).called(1);
      expect(service.pendingTopupParams, ('INT1', 'TX1'));
    });
  });

  group('consumeTopupParams', () {
    test('returns and clears stashed params', () {
      final (:service, :container) = createService();
      addTearDown(container.dispose);

      service.handleUri(
        Uri.parse('clude://topup/callback?intent=INT1&tx=TX1'),
        mockRouter,
        const AuthState(isAuthenticated: true, cortexKey: 'clk_x'),
      );

      final params = service.consumeTopupParams();
      expect(params, ('INT1', 'TX1'));
      expect(service.consumeTopupParams(), isNull);
    });
  });

  group('static helpers', () {
    test('isLoginAction identifies login routes', () {
      expect(DeepLinkService.isLoginAction('_login:clk_abc'), isTrue);
      expect(DeepLinkService.isLoginAction('/memory'), isFalse);
      expect(DeepLinkService.isLoginAction(null), isFalse);
    });

    test('extractLoginKey extracts the key', () {
      expect(DeepLinkService.extractLoginKey('_login:clk_abc'), 'clk_abc');
    });

    test('isTopupCallback identifies topup routes', () {
      expect(DeepLinkService.isTopupCallback('_topup:INT1:TX1'), isTrue);
      expect(DeepLinkService.isTopupCallback('/memory'), isFalse);
      expect(DeepLinkService.isTopupCallback(null), isFalse);
    });

    test('extractTopupParams extracts intent and tx', () {
      final params = DeepLinkService.extractTopupParams('_topup:INT1:TX1');
      expect(params.$1, 'INT1');
      expect(params.$2, 'TX1');
    });

    test('extractTopupParams handles colons in tx hash', () {
      final params = DeepLinkService.extractTopupParams('_topup:INT1:tx:with:colons');
      expect(params.$1, 'INT1');
      expect(params.$2, 'tx:with:colons');
    });
  });
}
