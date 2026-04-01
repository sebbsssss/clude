import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/interceptors/auth_interceptor.dart';
import 'package:clude_mobile/core/api/interceptors/auth_expired_interceptor.dart';
import 'package:clude_mobile/core/router.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

class MockRef extends Mock implements Ref {}

class MockRequestInterceptorHandler extends Mock
    implements RequestInterceptorHandler {}

class MockErrorInterceptorHandler extends Mock
    implements ErrorInterceptorHandler {}

void main() {
  group('AuthInterceptor', () {
    late MockRef mockRef;
    late AuthInterceptor interceptor;
    late MockRequestInterceptorHandler handler;

    setUp(() {
      mockRef = MockRef();
      interceptor = AuthInterceptor(mockRef);
      handler = MockRequestInterceptorHandler();
    });

    test('adds Bearer header when cortexKey is set', () {
      when(() => mockRef.read(cortexKeyProvider)).thenReturn('clk_test123');
      final options = RequestOptions(path: '/api/test');

      interceptor.onRequest(options, handler);

      expect(options.headers['Authorization'], 'Bearer clk_test123');
      verify(() => handler.next(options)).called(1);
    });

    test('does not add header when cortexKey is null', () {
      when(() => mockRef.read(cortexKeyProvider)).thenReturn(null);
      final options = RequestOptions(path: '/api/test');

      interceptor.onRequest(options, handler);

      expect(options.headers.containsKey('Authorization'), false);
      verify(() => handler.next(options)).called(1);
    });

    test('skips auth when skipAuth extra flag is set', () {
      when(() => mockRef.read(cortexKeyProvider)).thenReturn('clk_test123');
      final options = RequestOptions(
        path: '/api/test',
        extra: {'skipAuth': true},
      );

      interceptor.onRequest(options, handler);

      expect(options.headers.containsKey('Authorization'), false);
      verify(() => handler.next(options)).called(1);
    });
  });

  group('AuthExpiredInterceptor', () {
    late MockRef mockRef;
    late AuthExpiredInterceptor interceptor;
    late MockErrorInterceptorHandler handler;

    setUp(() {
      mockRef = MockRef();
      interceptor = AuthExpiredInterceptor(mockRef);
      handler = MockErrorInterceptorHandler();
    });

    test('clears auth on 401 when key exists', () {
      when(() => mockRef.read(cortexKeyProvider)).thenReturn('clk_test');

      final mockKeyNotifier = MockStateNotifier<String?>();
      when(() => mockRef.read(cortexKeyProvider.notifier))
          .thenReturn(mockKeyNotifier);

      final mockAuthNotifier = MockStateNotifier<bool>();
      when(() => mockRef.read(authStateProvider.notifier))
          .thenReturn(mockAuthNotifier);

      final error = DioException(
        requestOptions: RequestOptions(path: '/api/test'),
        response: Response(
          statusCode: 401,
          requestOptions: RequestOptions(path: '/api/test'),
        ),
      );

      interceptor.onError(error, handler);

      verify(() => mockKeyNotifier.state = null).called(1);
      verify(() => mockAuthNotifier.state = false).called(1);
      verify(() => handler.next(error)).called(1);
    });

    test('does not clear auth on 401 when key is null', () {
      when(() => mockRef.read(cortexKeyProvider)).thenReturn(null);

      final error = DioException(
        requestOptions: RequestOptions(path: '/api/test'),
        response: Response(
          statusCode: 401,
          requestOptions: RequestOptions(path: '/api/test'),
        ),
      );

      interceptor.onError(error, handler);

      verifyNever(() => mockRef.read(cortexKeyProvider.notifier));
      verify(() => handler.next(error)).called(1);
    });

    test('does not clear auth on non-401 errors', () {
      when(() => mockRef.read(cortexKeyProvider)).thenReturn('clk_test');

      final error = DioException(
        requestOptions: RequestOptions(path: '/api/test'),
        response: Response(
          statusCode: 500,
          requestOptions: RequestOptions(path: '/api/test'),
        ),
      );

      interceptor.onError(error, handler);

      verifyNever(() => mockRef.read(cortexKeyProvider.notifier));
      verify(() => handler.next(error)).called(1);
    });
  });
}

class MockStateNotifier<T> extends Mock implements StateController<T> {}
