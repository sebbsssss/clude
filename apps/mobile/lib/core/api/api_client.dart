import 'package:dio/dio.dart';

import 'api_exceptions.dart';
import 'models/agent.dart';
import 'models/chat_model.dart';
import 'models/entity_data.dart';
import 'models/graph_data.dart';
import 'models/conversation.dart';
import 'models/memory_stats.dart';
import 'models/memory_summary.dart';
import 'models/responses.dart';
import 'sse_parser.dart';

class ApiClient {
  final Dio _dio;

  ApiClient(this._dio);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  Future<T> _fetchJson<T>(
    String path, {
    String method = 'GET',
    Object? data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    T Function(dynamic json)? fromJson,
  }) async {
    try {
      final opts = options ?? Options();
      opts.method = method;
      final response = await _dio.request<dynamic>(
        path,
        options: opts,
        data: data,
        queryParameters: queryParameters,
      );
      if (fromJson != null) return fromJson(response.data);
      return response.data as T;
    } on DioException catch (e) {
      if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout) {
        throw NetworkException(e.message ?? 'Network error');
      }
      if (e.response?.statusCode == 401) {
        throw AuthExpiredException();
      }
      final msg = e.response?.data?['error']?.toString() ??
          e.message ??
          'Request failed';
      throw ApiException(msg);
    }
  }

  Stream<SseEvent> _streamSse(
    String path, {
    Object? data,
    CancelToken? cancelToken,
  }) async* {
    final Response<ResponseBody> response;
    try {
      response = await _dio.post<ResponseBody>(
        path,
        data: data,
        options: Options(responseType: ResponseType.stream),
        cancelToken: cancelToken,
      );
    } on DioException catch (e) {
      if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout) {
        throw NetworkException(e.message ?? 'Network error');
      }
      if (e.response?.statusCode == 401) {
        throw AuthExpiredException();
      }
      if (e.response?.statusCode == 429) {
        throw RateLimitException();
      }
      String msg = e.message ?? 'Stream failed';
      final data = e.response?.data;
      if (data is Map) {
        msg = data['error']?.toString() ?? msg;
      }
      throw ApiException(msg);
    }

    yield* parseSseStream(response.data!.stream);
  }

  // ---------------------------------------------------------------------------
  // Auth / Registration
  // ---------------------------------------------------------------------------

  Future<AutoRegisterResponse> autoRegister(
    String privyToken,
    String wallet,
  ) =>
      _fetchJson(
        '/api/chat/auto-register',
        method: 'POST',
        data: {'wallet': wallet},
        options: Options(
          headers: {'Authorization': 'Bearer $privyToken'},
          extra: {'skipAuth': true},
        ),
        fromJson: (json) =>
            AutoRegisterResponse.fromJson(json as Map<String, dynamic>),
      );

  Future<bool> validateKey() async {
    try {
      await _dio.get<dynamic>('/api/cortex/stats');
      return true;
    } catch (_) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Models
  // ---------------------------------------------------------------------------

  Future<List<ChatModel>> getModels() => _fetchJson(
        '/api/chat/models',
        fromJson: (json) => (json as List<dynamic>)
            .map((e) => ChatModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  Future<Conversation> createConversation({String? model}) => _fetchJson(
        '/api/chat/conversations',
        method: 'POST',
        data: {'model': model},
        fromJson: (json) =>
            Conversation.fromJson(json as Map<String, dynamic>),
      );

  Future<List<Conversation>> listConversations({int limit = 50}) => _fetchJson(
        '/api/chat/conversations',
        queryParameters: {'limit': limit},
        fromJson: (json) => (json as List<dynamic>)
            .map((e) => Conversation.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<ConversationDetail> getConversation(String id, {String? before}) =>
      _fetchJson(
        '/api/chat/conversations/$id',
        queryParameters: before != null ? {'before': before} : null,
        fromJson: (json) =>
            ConversationDetail.fromJson(json as Map<String, dynamic>),
      );

  Future<void> deleteConversation(String id) => _fetchJson<dynamic>(
        '/api/chat/conversations/$id',
        method: 'DELETE',
      );

  // ---------------------------------------------------------------------------
  // Messaging (SSE)
  // ---------------------------------------------------------------------------

  Stream<SseEvent> sendMessage(
    String conversationId,
    String content,
    String model, {
    CancelToken? cancelToken,
  }) =>
      _streamSse(
        '/api/chat/messages',
        data: {
          'conversationId': conversationId,
          'content': content,
          'model': model,
        },
        cancelToken: cancelToken,
      );

  Stream<SseEvent> sendGuestMessage(
    String content,
    List<Map<String, String>> history, {
    CancelToken? cancelToken,
  }) =>
      _streamSse(
        '/api/chat/guest',
        data: {'content': content, 'history': history},
        cancelToken: cancelToken,
      );

  Stream<SseEvent> greet({CancelToken? cancelToken}) => _streamSse(
        '/api/chat/greet',
        data: {},
        cancelToken: cancelToken,
      );

  // ---------------------------------------------------------------------------
  // Memory
  // ---------------------------------------------------------------------------

  Future<MemoryStats> getMemoryStats() => _fetchJson(
        '/api/cortex/stats',
        fromJson: (json) =>
            MemoryStats.fromJson(json as Map<String, dynamic>),
      );

  Future<List<MemorySummary>> getRecentMemories({int limit = 20, int offset = 0}) =>
      _fetchJson(
        '/api/cortex/recent',
        queryParameters: {'limit': limit, 'offset': offset},
        fromJson: (json) {
          final data = json is Map ? (json['memories'] ?? json) : json;
          return (data as List<dynamic>)
              .map((e) => MemorySummary.fromJson(e as Map<String, dynamic>))
              .toList();
        },
      );

  Future<GraphData> getMemoryGraph({int limit = 200}) => _fetchJson(
        '/api/cortex/brain/graph',
        queryParameters: {'limit': limit},
        fromJson: (json) =>
            GraphData.fromJson(json as Map<String, dynamic>),
      );

  Future<List<GraphEntity>> getEntities() => _fetchJson(
        '/api/cortex/entities',
        fromJson: (json) {
          final map = json as Map<String, dynamic>;
          final entities = (map['entities'] ?? []) as List;
          return entities
              .map((e) => GraphEntity.fromJson(e as Map<String, dynamic>))
              .toList();
        },
      );

  Future<List<GraphEntity>> searchEntities(String query) => _fetchJson(
        '/api/cortex/entities/search',
        queryParameters: {'q': query},
        fromJson: (json) {
          final map = json as Map<String, dynamic>;
          final entities = (map['entities'] ?? []) as List;
          return entities
              .map((e) => GraphEntity.fromJson(e as Map<String, dynamic>))
              .toList();
        },
      );

  Future<EntityDetail> getEntityDetail(int id) => _fetchJson(
        '/api/cortex/entities/$id',
        fromJson: (json) =>
            EntityDetail.fromJson(json as Map<String, dynamic>),
      );

  Future<ImportResult> importMemoryPack(Map<String, dynamic> pack) =>
      _fetchJson(
        '/api/cortex/packs/import',
        method: 'POST',
        data: {'pack': pack},
        fromJson: (json) =>
            ImportResult.fromJson(json as Map<String, dynamic>),
      );

  // ---------------------------------------------------------------------------
  // Billing
  // ---------------------------------------------------------------------------

  Future<Balance> getBalance() => _fetchJson(
        '/api/chat/balance',
        fromJson: (json) => Balance.fromJson(json as Map<String, dynamic>),
      );

  Future<TopupIntent> createTopupIntent(
    double amountUsdc,
    String chain,
  ) =>
      _fetchJson(
        '/api/chat/topup/intent',
        method: 'POST',
        data: {'amount_usdc': amountUsdc, 'chain': chain},
        fromJson: (json) =>
            TopupIntent.fromJson(json as Map<String, dynamic>),
      );

  Future<TopupConfirmation> confirmTopup(
    String txHash,
    String intentId,
  ) =>
      _fetchJson(
        '/api/chat/topup/confirm',
        method: 'POST',
        data: {'tx_hash': txHash, 'intent_id': intentId},
        fromJson: (json) =>
            TopupConfirmation.fromJson(json as Map<String, dynamic>),
      );

  Future<TopupStatus> checkTopupStatus(String intentId) => _fetchJson(
        '/api/chat/topup/status/$intentId',
        fromJson: (json) =>
            TopupStatus.fromJson(json as Map<String, dynamic>),
      );

  Future<List<UsageRecord>> getUsageHistory() => _fetchJson(
        '/api/chat/usage/history',
        fromJson: (json) =>
            ((json as Map<String, dynamic>)['records'] as List? ?? [])
                .map((e) => UsageRecord.fromJson(e as Map<String, dynamic>))
                .toList(),
      );

  Future<List<TopupRecord>> getTopupHistory() => _fetchJson(
        '/api/chat/topup/history',
        fromJson: (json) =>
            ((json as Map<String, dynamic>)['topups'] as List? ?? [])
                .map((e) => TopupRecord.fromJson(e as Map<String, dynamic>))
                .toList(),
      );

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------

  Future<List<Agent>> listAgents() => _fetchJson(
        '/api/cortex/agents',
        fromJson: (json) =>
            (json as List<dynamic>).map((e) => Agent.fromJson(e as Map<String, dynamic>)).toList(),
      );
}
