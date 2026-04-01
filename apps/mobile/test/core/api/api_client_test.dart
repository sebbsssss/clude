import 'dart:convert';

import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_exceptions.dart';
import 'package:clude_mobile/core/api/sse_parser.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

class MockDio extends Mock implements Dio {
  @override
  BaseOptions get options => BaseOptions(baseUrl: 'https://test.com');
}

class MockHttpClientAdapter extends Mock implements HttpClientAdapter {}

// Needed for mocktail's any() matchers
class FakeOptions extends Fake implements Options {}

class FakeRequestOptions extends Fake implements RequestOptions {}

void main() {
  late MockDio mockDio;
  late ApiClient apiClient;

  setUpAll(() {
    registerFallbackValue(FakeOptions());
    registerFallbackValue(FakeRequestOptions());
    registerFallbackValue(CancelToken());
  });

  setUp(() {
    mockDio = MockDio();
    apiClient = ApiClient(mockDio);
  });

  Response<T> _ok<T>(T data) => Response<T>(
        data: data,
        statusCode: 200,
        requestOptions: RequestOptions(path: ''),
      );

  DioException _dioError(int statusCode, {String? message}) => DioException(
        type: DioExceptionType.badResponse,
        requestOptions: RequestOptions(path: ''),
        response: Response(
          statusCode: statusCode,
          requestOptions: RequestOptions(path: ''),
          data: message != null ? {'error': message} : null,
        ),
      );

  DioException _networkError() => DioException(
        type: DioExceptionType.connectionError,
        requestOptions: RequestOptions(path: ''),
        message: 'No internet',
      );

  group('ApiClient', () {
    group('getModels', () {
      test('returns list of ChatModel', () async {
        when(() => mockDio.request<dynamic>(
              '/api/chat/models',
              options: any(named: 'options'),
              data: any(named: 'data'),
              queryParameters: any(named: 'queryParameters'),
            )).thenAnswer((_) async => _ok<dynamic>([
              {
                'id': 'gpt-4',
                'name': 'GPT-4',
                'privacy': 'private',
                'context': 128000,
                'default': true,
                'tier': 'pro',
                'cost': {'input': 0.03, 'output': 0.06},
              }
            ]));

        final models = await apiClient.getModels();
        expect(models, hasLength(1));
        expect(models.first.id, 'gpt-4');
        expect(models.first.isDefault, true);
        expect(models.first.cost.input, 0.03);
      });
    });

    group('listConversations', () {
      test('passes limit query parameter', () async {
        when(() => mockDio.request<dynamic>(
              '/api/chat/conversations',
              options: any(named: 'options'),
              data: any(named: 'data'),
              queryParameters: {'limit': 10},
            )).thenAnswer((_) async => _ok<dynamic>([
              {
                'id': 'c1',
                'owner_wallet': '0xabc',
                'title': 'Test',
                'model': 'gpt-4',
                'message_count': 5,
                'created_at': '2026-01-01T00:00:00Z',
                'updated_at': '2026-01-01T00:00:00Z',
              }
            ]));

        final convos = await apiClient.listConversations(limit: 10);
        expect(convos, hasLength(1));
        expect(convos.first.ownerWallet, '0xabc');
      });
    });

    group('getConversation', () {
      test('returns ConversationDetail with messages', () async {
        when(() => mockDio.request<dynamic>(
              '/api/chat/conversations/c1',
              options: any(named: 'options'),
              data: any(named: 'data'),
              queryParameters: any(named: 'queryParameters'),
            )).thenAnswer((_) async => _ok<dynamic>({
              'id': 'c1',
              'owner_wallet': '0xabc',
              'title': null,
              'model': 'gpt-4',
              'message_count': 1,
              'created_at': '2026-01-01T00:00:00Z',
              'updated_at': '2026-01-01T00:00:00Z',
              'messages': [
                {
                  'id': 'm1',
                  'conversation_id': 'c1',
                  'role': 'user',
                  'content': 'Hello',
                  'created_at': '2026-01-01T00:00:00Z',
                }
              ],
              'hasMore': false,
            }));

        final detail = await apiClient.getConversation('c1');
        expect(detail.messages, hasLength(1));
        expect(detail.messages.first.content, 'Hello');
        expect(detail.hasMore, false);
      });
    });

    group('validateKey', () {
      test('returns true on success', () async {
        when(() => mockDio.get<dynamic>(
              '/api/cortex/stats',
              data: any(named: 'data'),
              queryParameters: any(named: 'queryParameters'),
              options: any(named: 'options'),
              cancelToken: any(named: 'cancelToken'),
              onReceiveProgress: any(named: 'onReceiveProgress'),
            )).thenAnswer((_) async => _ok<dynamic>({'total': 100}));

        expect(await apiClient.validateKey(), true);
      });

      test('returns false on error', () async {
        when(() => mockDio.get<dynamic>(
              '/api/cortex/stats',
              data: any(named: 'data'),
              queryParameters: any(named: 'queryParameters'),
              options: any(named: 'options'),
              cancelToken: any(named: 'cancelToken'),
              onReceiveProgress: any(named: 'onReceiveProgress'),
            )).thenThrow(_dioError(401));

        expect(await apiClient.validateKey(), false);
      });
    });

    group('error handling', () {
      test('throws NetworkException on connection error', () async {
        when(() => mockDio.request<dynamic>(
              any(),
              options: any(named: 'options'),
              data: any(named: 'data'),
              queryParameters: any(named: 'queryParameters'),
            )).thenThrow(_networkError());

        expect(
          () => apiClient.getModels(),
          throwsA(isA<NetworkException>()),
        );
      });

      test('throws AuthExpiredException on 401', () async {
        when(() => mockDio.request<dynamic>(
              any(),
              options: any(named: 'options'),
              data: any(named: 'data'),
              queryParameters: any(named: 'queryParameters'),
            )).thenThrow(_dioError(401));

        expect(
          () => apiClient.getModels(),
          throwsA(isA<AuthExpiredException>()),
        );
      });

      test('throws ApiException with server error message', () async {
        when(() => mockDio.request<dynamic>(
              any(),
              options: any(named: 'options'),
              data: any(named: 'data'),
              queryParameters: any(named: 'queryParameters'),
            )).thenThrow(_dioError(500, message: 'Internal error'));

        expect(
          () => apiClient.getModels(),
          throwsA(
            isA<ApiException>().having((e) => e.message, 'message', 'Internal error'),
          ),
        );
      });
    });

    group('autoRegister', () {
      test('passes privy token and skipAuth flag', () async {
        when(() => mockDio.request<dynamic>(
              '/api/chat/auto-register',
              options: any(named: 'options'),
              data: any(named: 'data'),
              queryParameters: any(named: 'queryParameters'),
            )).thenAnswer((_) async => _ok<dynamic>({
              'api_key': 'clk_123',
              'agent_id': 'agent_1',
              'created': true,
            }));

        final result =
            await apiClient.autoRegister('privy_token_abc', '0xwallet');
        expect(result.apiKey, 'clk_123');
        expect(result.created, true);

        final captured = verify(() => mockDio.request<dynamic>(
              '/api/chat/auto-register',
              options: captureAny(named: 'options'),
              data: any(named: 'data'),
              queryParameters: any(named: 'queryParameters'),
            )).captured.first as Options;

        expect(captured.headers?['Authorization'], 'Bearer privy_token_abc');
        expect(captured.extra?['skipAuth'], true);
      });
    });

    group('getBalance', () {
      test('deserializes balance response', () async {
        when(() => mockDio.request<dynamic>(
              '/api/chat/balance',
              options: any(named: 'options'),
              data: any(named: 'data'),
              queryParameters: any(named: 'queryParameters'),
            )).thenAnswer((_) async => _ok<dynamic>({
              'balance_usdc': 42.5,
              'wallet_address': '0xabc',
              'promo': true,
              'promo_credit_usdc': 10.0,
            }));

        final balance = await apiClient.getBalance();
        expect(balance.balanceUsdc, 42.5);
        expect(balance.promo, true);
        expect(balance.promoCreditUsdc, 10.0);
      });
    });

    group('getRecentMemories', () {
      test('handles wrapped response with memories key', () async {
        when(() => mockDio.request<dynamic>(
              '/api/cortex/recent',
              options: any(named: 'options'),
              data: any(named: 'data'),
              queryParameters: {'limit': 5},
            )).thenAnswer((_) async => _ok<dynamic>({
              'memories': [
                {
                  'id': 1,
                  'memory_type': 'episodic',
                  'summary': 'Test memory',
                  'importance': 0.8,
                  'created_at': '2026-01-01T00:00:00Z',
                }
              ]
            }));

        final memories = await apiClient.getRecentMemories(limit: 5);
        expect(memories, hasLength(1));
        expect(memories.first.memoryType, 'episodic');
      });
    });
  });
}
