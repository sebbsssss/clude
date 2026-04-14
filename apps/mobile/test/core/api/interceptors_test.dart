import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/interceptors/auth_interceptor.dart';
import 'package:clude_mobile/core/api/interceptors/auth_expired_interceptor.dart';
import 'package:clude_mobile/core/auth/auth_notifier.dart';
import 'package:clude_mobile/core/auth/auth_provider.dart';
import 'package:clude_mobile/core/auth/auth_state.dart';
import 'package:clude_mobile/core/auth/selected_agent_provider.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

class MockRef extends Mock implements Ref {}

class MockRequestInterceptorHandler extends Mock
    implements RequestInterceptorHandler {}

class MockErrorInterceptorHandler extends Mock
    implements ErrorInterceptorHandler {}

class _MockAuthNotifier extends StateNotifier<AuthState>
    with Mock
    implements AuthNotifier {
  _MockAuthNotifier() : super(const AuthState());
}

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
      when(() => mockRef.read(selectedAgentNotifierProvider))
          .thenReturn(const AsyncValue.data(null));
      final options = RequestOptions(path: '/api/test');

      interceptor.onRequest(options, handler);

      expect(options.headers['Authorization'], 'Bearer clk_test123');
      verify(() => handler.next(options)).called(1);
    });

    test('does not add header when cortexKey is null', () {
      when(() => mockRef.read(cortexKeyProvider)).thenReturn(null);
      when(() => mockRef.read(selectedAgentNotifierProvider))
          .thenReturn(const AsyncValue.data(null));
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
    late _MockAuthNotifier mockAuthNotifier;

    setUp(() {
      mockRef = MockRef();
      interceptor = AuthExpiredInterceptor(mockRef);
      handler = MockErrorInterceptorHandler();
      mockAuthNotifier = _MockAuthNotifier();
    });

    test('clears auth on 401 from cortex endpoint', () {
      when(() => mockRef.read(authNotifierProvider))
          .thenReturn(const AuthState(isAuthenticated: true, cortexKey: 'clk_test'));
      when(() => mockRef.read(authNotifierProvider.notifier))
          .thenReturn(mockAuthNotifier);

      final error = DioException(
        requestOptions: RequestOptions(path: '/api/cortex/stats'),
        response: Response(
          statusCode: 401,
          requestOptions: RequestOptions(path: '/api/cortex/stats'),
        ),
      );

      interceptor.onError(error, handler);

      verify(() => mockAuthNotifier.clearAuth()).called(1);
      verify(() => handler.next(error)).called(1);
    });

    test('clears auth on 401 from chat endpoint', () {
      when(() => mockRef.read(authNotifierProvider))
          .thenReturn(const AuthState(isAuthenticated: true, cortexKey: 'clk_test'));
      when(() => mockRef.read(authNotifierProvider.notifier))
          .thenReturn(mockAuthNotifier);

      final error = DioException(
        requestOptions: RequestOptions(path: '/api/chat/conversations'),
        response: Response(
          statusCode: 401,
          requestOptions: RequestOptions(path: '/api/chat/conversations'),
        ),
      );

      interceptor.onError(error, handler);

      verify(() => mockAuthNotifier.clearAuth()).called(1);
      verify(() => handler.next(error)).called(1);
    });

    test('does NOT clear auth on 401 from dashboard endpoint', () {
      when(() => mockRef.read(authNotifierProvider))
          .thenReturn(const AuthState(isAuthenticated: true, cortexKey: 'clk_test'));

      final error = DioException(
        requestOptions: RequestOptions(path: '/api/dashboard/agents'),
        response: Response(
          statusCode: 401,
          requestOptions: RequestOptions(path: '/api/dashboard/agents'),
        ),
      );

      interceptor.onError(error, handler);

      verifyNever(() => mockRef.read(authNotifierProvider.notifier));
      verify(() => handler.next(error)).called(1);
    });

    test('does NOT clear auth on 401 from graph endpoint', () {
      when(() => mockRef.read(authNotifierProvider))
          .thenReturn(const AuthState(isAuthenticated: true, cortexKey: 'clk_test'));

      final error = DioException(
        requestOptions: RequestOptions(path: '/api/graph/search'),
        response: Response(
          statusCode: 401,
          requestOptions: RequestOptions(path: '/api/graph/search'),
        ),
      );

      interceptor.onError(error, handler);

      verifyNever(() => mockRef.read(authNotifierProvider.notifier));
      verify(() => handler.next(error)).called(1);
    });

    test('does not clear auth on non-401 errors', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/api/cortex/stats'),
        response: Response(
          statusCode: 500,
          requestOptions: RequestOptions(path: '/api/cortex/stats'),
        ),
      );

      interceptor.onError(error, handler);

      verifyNever(() => mockRef.read(authNotifierProvider));
      verify(() => handler.next(error)).called(1);
    });
  });
}
