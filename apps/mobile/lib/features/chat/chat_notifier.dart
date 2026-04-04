import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client_provider.dart';
import '../../core/api/api_exceptions.dart';
import '../../core/api/models/responses.dart';
import '../../core/api/sse_parser.dart';
import 'chat_state.dart';
import 'conversation_list_provider.dart';
import 'models/display_message.dart';

class ChatNotifier extends StateNotifier<ChatState> {
  ChatNotifier(this._ref) : super(const ChatState());

  static bool _greetedThisSession = false;

  final Ref _ref;
  String _contentBuffer = '';
  Timer? _flushTimer;
  CancelToken? _cancelToken;
  StreamSubscription<SseEvent>? _sseSubscription;
  String? _conversationId;
  int _initialMessageCount = 0;

  Future<void> loadInitial(String conversationId) async {
    _conversationId = conversationId;

    // Cancel any in-progress greeting before reloading.
    if (_sseSubscription != null) {
      _cancelToken?.cancel();
      _stopFlushTimer();
      _sseSubscription?.cancel();
      _sseSubscription = null;
      _contentBuffer = '';
    }

    try {
      final client = _ref.read(apiClientProvider);
      final detail = await client.getConversation(conversationId);
      _initialMessageCount = detail.messageCount;
      final settled = detail.messages.map(settledFromMessage).toList().reversed.toList();
      final oldest = detail.messages.isNotEmpty ? detail.messages.first.createdAt : null;
      state = ChatState(
        settled: settled,
        hasMore: detail.hasMore,
        oldestTimestamp: oldest,
        title: detail.title,
        model: detail.model,
      );
      if (state.settled.isEmpty) {
        fetchGreeting();
      }
    } catch (e) {
      state = ChatState(error: e.toString());
    }
  }

  Future<void> send(String content, String model) async {
    if (_conversationId == null) return;

    // Cancel any in-progress greeting silently before sending.
    if (state.streamingMsg?.isGreeting == true) {
      _cancelToken?.cancel();
      _stopFlushTimer();
      _sseSubscription?.cancel();
      _sseSubscription = null;
      _contentBuffer = '';
      state = state.copyWith(streamingMsg: null);
    }

    if (state.streamingMsg != null) return;

    final tempId = 'temp-${DateTime.now().millisecondsSinceEpoch}';
    final userMsg = SettledMessage(id: tempId, role: 'user', content: content);

    _contentBuffer = '';
    state = state.copyWith(
      settled: [userMsg, ...state.settled],
      streamingMsg: StreamingMessage(id: 'stream-$tempId', content: ''),
      error: null,
    );

    _cancelToken = CancelToken();
    _startFlushTimer();

    try {
      final client = _ref.read(apiClientProvider);
      final stream = client.sendMessage(
        _conversationId!,
        content,
        model,
        cancelToken: _cancelToken,
      );

      _sseSubscription = stream.listen(
        (event) {
          switch (event) {
            case SseChunk(:final text):
              _contentBuffer += text;
            case SseDone(:final data):
              _onDone(data);
          }
        },
        onError: (Object error) => _onError(error),
        onDone: () {
          // Stream ended without explicit done event — flush what we have.
          if (state.streamingMsg != null) {
            _onDone(null);
          }
        },
      );
    } on ApiException catch (e) {
      _onError(e);
    } catch (e) {
      _onError(e);
    }
  }

  void stopStreaming() {
    _cancelToken?.cancel();
    _stopFlushTimer();
    _sseSubscription?.cancel();
    _sseSubscription = null;

    // Greeting streams are discarded silently — no partial content saved.
    if (state.streamingMsg?.isGreeting == true) {
      state = state.copyWith(streamingMsg: null);
      _contentBuffer = '';
      return;
    }

    if (_contentBuffer.isNotEmpty && state.streamingMsg != null) {
      final partial = SettledMessage(
        id: state.streamingMsg!.id,
        role: 'assistant',
        content: _contentBuffer,
      );
      state = state.copyWith(
        settled: [partial, ...state.settled],
        streamingMsg: null,
      );
    } else {
      state = state.copyWith(streamingMsg: null);
    }
    _contentBuffer = '';
  }

  Future<void> loadOlder() async {
    if (state.isLoadingOlder || !state.hasMore || _conversationId == null) return;

    state = state.copyWith(isLoadingOlder: true);
    try {
      final client = _ref.read(apiClientProvider);
      final detail = await client.getConversation(
        _conversationId!,
        before: state.oldestTimestamp,
      );
      final older = detail.messages.map(settledFromMessage).toList().reversed.toList();
      final oldest = detail.messages.isNotEmpty ? detail.messages.first.createdAt : state.oldestTimestamp;
      state = state.copyWith(
        settled: [...state.settled, ...older],
        hasMore: detail.hasMore,
        oldestTimestamp: oldest,
        isLoadingOlder: false,
      );
    } catch (e) {
      state = state.copyWith(isLoadingOlder: false, error: e.toString());
    }
  }

  Future<void> fetchGreeting() async {
    if (_greetedThisSession) return;
    _greetedThisSession = true;

    _contentBuffer = '';
    final streamId = 'greeting-${DateTime.now().millisecondsSinceEpoch}';
    state = state.copyWith(
      streamingMsg: StreamingMessage(id: streamId, content: '', isGreeting: true),
    );

    _cancelToken = CancelToken();
    _startFlushTimer();

    try {
      final client = _ref.read(apiClientProvider);
      final stream = client.greet(cancelToken: _cancelToken);

      _sseSubscription = stream.listen(
        (event) {
          switch (event) {
            case SseChunk(:final text):
              _contentBuffer += text;
            case SseDone(:final data):
              _onGreetingDone(data);
          }
        },
        onError: (Object error) => _onGreetingError(error),
        onDone: () {
          if (state.streamingMsg != null) {
            _onGreetingDone(null);
          }
        },
      );
    } catch (e) {
      _onGreetingError(e);
    }
  }

  void _onGreetingDone(Map<String, dynamic>? data) {
    _stopFlushTimer();
    _sseSubscription?.cancel();
    _sseSubscription = null;

    GreetingMeta? meta;
    if (data != null) {
      try {
        meta = GreetingMeta.fromJson(data);
      } catch (_) {}
    }

    final greetingMsg = SettledMessage(
      id: state.streamingMsg?.id ?? 'greeting',
      role: 'assistant',
      content: _contentBuffer.isNotEmpty
          ? _contentBuffer.trimLeft()
          : 'Hey! How can I help you today?',
      isGreeting: true,
      greetingMeta: meta,
    );

    state = state.copyWith(
      settled: [greetingMsg, ...state.settled],
      streamingMsg: null,
    );
    _contentBuffer = '';
  }

  void _onGreetingError(Object error) {
    _stopFlushTimer();
    _sseSubscription?.cancel();
    _sseSubscription = null;

    if (error is DioException && error.type == DioExceptionType.cancel) {
      state = state.copyWith(streamingMsg: null);
      _contentBuffer = '';
      return;
    }

    final fallback = SettledMessage(
      id: state.streamingMsg?.id ?? 'greeting-fallback',
      role: 'assistant',
      content: 'Hey! How can I help you today?',
      isGreeting: true,
    );
    state = state.copyWith(
      settled: [fallback, ...state.settled],
      streamingMsg: null,
    );
    _contentBuffer = '';
  }

  void _startFlushTimer() {
    _flushTimer = Timer.periodic(
      const Duration(milliseconds: 66),
      (_) => _flushBuffer(),
    );
  }

  void _stopFlushTimer() {
    _flushTimer?.cancel();
    _flushTimer = null;
  }

  void _flushBuffer() {
    final current = state.streamingMsg;
    if (current != null && current.content != _contentBuffer) {
      state = state.copyWith(
        streamingMsg: current.copyWith(content: _contentBuffer),
      );
    }
  }

  void _onDone(Map<String, dynamic>? data) {
    _stopFlushTimer();
    _sseSubscription?.cancel();
    _sseSubscription = null;

    StreamDoneData? doneData;
    if (data != null) {
      try {
        doneData = StreamDoneData.fromJson(data);
      } catch (_) {}
    }

    MessageCost? cost;
    if (doneData?.cost != null) {
      final c = doneData!.cost!;
      cost = MessageCost(
        total: (c['total'] as num?)?.toDouble() ?? 0,
        input: (c['input'] as num?)?.toDouble() ?? 0,
        output: (c['output'] as num?)?.toDouble() ?? 0,
      );
    }

    MessageTokens? tokens;
    if (doneData?.tokens != null) {
      final t = doneData!.tokens!;
      tokens = MessageTokens(
        prompt: (t['prompt_tokens'] as num?)?.toInt() ?? 0,
        completion: (t['completion_tokens'] as num?)?.toInt() ?? 0,
      );
    }

    final assistantMsg = SettledMessage(
      id: doneData?.messageId ?? state.streamingMsg?.id ?? 'unknown',
      role: 'assistant',
      content: _contentBuffer,
      model: doneData?.model,
      memoryIds: doneData?.memoryIds,
      cost: cost,
      tokens: tokens,
      receipt: doneData?.receipt,
    );

    state = state.copyWith(
      settled: [assistantMsg, ...state.settled],
      streamingMsg: null,
    );
    _contentBuffer = '';

    // Refresh title after first exchange in a new conversation.
    if (_initialMessageCount == 0 && _conversationId != null) {
      _refreshTitle(_conversationId!);
    }
  }

  void _onError(Object error) {
    _stopFlushTimer();
    _sseSubscription?.cancel();
    _sseSubscription = null;

    // On cancel (user stop), don't show error — stopStreaming handles it.
    if (error is DioException && error.type == DioExceptionType.cancel) return;

    if (_contentBuffer.isNotEmpty && state.streamingMsg != null) {
      final partial = SettledMessage(
        id: state.streamingMsg!.id,
        role: 'assistant',
        content: _contentBuffer,
      );
      state = state.copyWith(
        settled: [partial, ...state.settled],
        streamingMsg: null,
        error: 'Response interrupted',
      );
    } else {
      state = state.copyWith(
        streamingMsg: null,
        error: error.toString(),
      );
    }
    _contentBuffer = '';
  }

  Future<void> _refreshTitle(String conversationId) async {
    try {
      final client = _ref.read(apiClientProvider);
      final detail = await client.getConversation(conversationId);
      if (detail.title != null) {
        state = state.copyWith(title: detail.title);
        _ref
            .read(conversationListNotifierProvider.notifier)
            .updateTitle(conversationId, detail.title!);
      }
    } catch (_) {
      // Non-critical — ignore title refresh failures.
    }
  }

  @override
  void dispose() {
    _stopFlushTimer();
    _cancelToken?.cancel();
    _sseSubscription?.cancel();
    super.dispose();
  }
}
