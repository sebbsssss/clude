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

final _testInterceptorProvider = Provider<AuthInterceptor>((ref) {
  return AuthInterceptor(ref);
});

void main() {
  late MockSecureStorage mockStorage;

  setUp(() {
    mockStorage = MockSecureStorage();
    when(() => mockStorage.getSelectedAgentId()).thenAnswer((_) async => null);
  });

  Future<ProviderContainer> createContainer() async {
    final container = ProviderContainer(
      overrides: [
        cortexKeyProvider.overrideWith((ref) => 'clk_test'),
        secureStorageProvider.overrideWithValue(mockStorage),
      ],
    );
    await container.read(selectedAgentNotifierProvider.future);
    return container;
  }

  group('AuthInterceptor BYOK headers', () {
    test('adds BYOK headers when extra contains byokKey and byokProvider', () async {
      final container = await createContainer();
      addTearDown(container.dispose);

      final interceptor = container.read(_testInterceptorProvider);
      final options = RequestOptions(
        path: '/api/chat/messages',
        extra: {
          'byokKey': 'sk-ant-test123',
          'byokProvider': 'anthropic',
        },
      );
      final handler = _MockHandler();
      interceptor.onRequest(options, handler);

      expect(options.headers['X-BYOK-Key'], 'sk-ant-test123');
      expect(options.headers['X-BYOK-Provider'], 'anthropic');
      expect(options.headers['Authorization'], 'Bearer clk_test');
      expect(handler.nextCalled, isTrue);
    });

    test('does not add BYOK headers when extra is empty', () async {
      final container = await createContainer();
      addTearDown(container.dispose);

      final interceptor = container.read(_testInterceptorProvider);
      final options = RequestOptions(path: '/api/chat/messages');
      final handler = _MockHandler();
      interceptor.onRequest(options, handler);

      expect(options.headers.containsKey('X-BYOK-Key'), isFalse);
      expect(options.headers.containsKey('X-BYOK-Provider'), isFalse);
    });

    test('does not add BYOK headers when only byokKey is present', () async {
      final container = await createContainer();
      addTearDown(container.dispose);

      final interceptor = container.read(_testInterceptorProvider);
      final options = RequestOptions(
        path: '/api/chat/messages',
        extra: {'byokKey': 'sk-ant-test123'},
      );
      final handler = _MockHandler();
      interceptor.onRequest(options, handler);

      expect(options.headers.containsKey('X-BYOK-Key'), isFalse);
      expect(options.headers.containsKey('X-BYOK-Provider'), isFalse);
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
