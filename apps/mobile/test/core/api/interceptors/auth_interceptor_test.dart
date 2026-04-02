import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/interceptors/auth_interceptor.dart';
import 'package:clude_mobile/core/auth/selected_agent_provider.dart';
import 'package:clude_mobile/core/storage/secure_storage.dart';
import 'package:clude_mobile/core/storage/secure_storage_provider.dart';

class MockSecureStorage extends Mock implements SecureStorageService {}

/// Helper provider that exposes AuthInterceptor with a real Ref.
final _testInterceptorProvider = Provider<AuthInterceptor>((ref) {
  return AuthInterceptor(ref);
});

void main() {
  group('AuthInterceptor', () {
    late MockSecureStorage mockStorage;

    setUp(() {
      mockStorage = MockSecureStorage();
    });

    Future<ProviderContainer> createContainer({
      String? cortexKey,
      String? agentId,
    }) async {
      when(() => mockStorage.getSelectedAgentId())
          .thenAnswer((_) async => agentId);
      when(() => mockStorage.setSelectedAgentId(any()))
          .thenAnswer((_) async {});

      final container = ProviderContainer(
        overrides: [
          cortexKeyProvider.overrideWith((ref) => cortexKey),
          secureStorageProvider.overrideWithValue(mockStorage),
        ],
      );

      // Wait for the async notifier to build
      await container.read(selectedAgentNotifierProvider.future);

      return container;
    }

    test('adds Authorization header when key exists', () async {
      final container = await createContainer(cortexKey: 'clk_test_key');
      addTearDown(container.dispose);

      final interceptor = container.read(_testInterceptorProvider);
      final options = RequestOptions(path: '/api/test');
      final handler = _MockHandler();

      interceptor.onRequest(options, handler);

      expect(options.headers['Authorization'], 'Bearer clk_test_key');
      expect(handler.nextCalled, isTrue);
    });

    test('adds agent_id query param when agent is selected', () async {
      final container = await createContainer(
        cortexKey: 'clk_test_key',
        agentId: 'agent-123',
      );
      addTearDown(container.dispose);

      final interceptor = container.read(_testInterceptorProvider);
      final options = RequestOptions(path: '/api/test');
      final handler = _MockHandler();

      interceptor.onRequest(options, handler);

      expect(options.queryParameters['agent_id'], 'agent-123');
    });

    test('does not add agent_id when no agent selected', () async {
      final container = await createContainer(cortexKey: 'clk_test_key');
      addTearDown(container.dispose);

      final interceptor = container.read(_testInterceptorProvider);
      final options = RequestOptions(path: '/api/test');
      final handler = _MockHandler();

      interceptor.onRequest(options, handler);

      expect(options.queryParameters.containsKey('agent_id'), isFalse);
    });

    test('skips auth when skipAuth extra is true', () async {
      final container = await createContainer(
        cortexKey: 'clk_test_key',
        agentId: 'agent-123',
      );
      addTearDown(container.dispose);

      final interceptor = container.read(_testInterceptorProvider);
      final options = RequestOptions(
        path: '/api/test',
        extra: {'skipAuth': true},
      );
      final handler = _MockHandler();

      interceptor.onRequest(options, handler);

      expect(options.headers.containsKey('Authorization'), isFalse);
      expect(options.queryParameters.containsKey('agent_id'), isFalse);
    });
  });
}

class _MockHandler extends RequestInterceptorHandler {
  bool nextCalled = false;

  @override
  void next(RequestOptions requestOptions) {
    nextCalled = true;
  }
}
