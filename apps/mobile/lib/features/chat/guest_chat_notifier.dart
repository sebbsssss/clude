import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client_provider.dart';
import '../../core/api/api_exceptions.dart';
import '../../core/api/sse_parser.dart';
import 'models/display_message.dart';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class GuestChatState {
  const GuestChatState({
    this.settled = const [],
    this.streamingMsg,
    this.remaining,
    this.error,
  });

  final List<SettledMessage> settled;
  final StreamingMessage? streamingMsg;
  final int? remaining;
  final String? error;

  GuestChatState copyWith({
    List<SettledMessage>? settled,
    StreamingMessage? Function()? streamingMsg,
    int? Function()? remaining,
    String? Function()? error,
  }) =>
      GuestChatState(
        settled: settled ?? this.settled,
        streamingMsg: streamingMsg != null ? streamingMsg() : this.streamingMsg,
        remaining: remaining != null ? remaining() : this.remaining,
        error: error != null ? error() : this.error,
      );
}

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------

class GuestChatNotifier extends StateNotifier<GuestChatState> {
  GuestChatNotifier(this._ref) : super(const GuestChatState());

  final Ref _ref;
  String _contentBuffer = '';
  Timer? _flushTimer;
  CancelToken? _cancelToken;
  StreamSubscription<SseEvent>? _sseSubscription;

  Future<void> send(String content) async {
    if (state.streamingMsg != null || state.remaining == 0) return;

    final history = state.settled
        .where((m) => m.content.isNotEmpty)
        .take(10)
        .toList()
        .reversed
        .map((m) => {'role': m.role, 'content': m.content})
        .toList();

    final tempId = 'temp-${DateTime.now().millisecondsSinceEpoch}';
    final userMsg = SettledMessage(id: tempId, role: 'user', content: content);

    _contentBuffer = '';
    state = state.copyWith(
      settled: [userMsg, ...state.settled],
      streamingMsg: () => StreamingMessage(id: 'stream-$tempId', content: ''),
      error: () => null,
    );

    _cancelToken = CancelToken();
    _startFlushTimer();

    try {
      final client = _ref.read(apiClientProvider);
      final stream = client.sendGuestMessage(
        content,
        history,
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
          if (state.streamingMsg != null) _onDone(null);
        },
      );
    } on RateLimitException {
      _stopFlushTimer();
      state = state.copyWith(
        streamingMsg: () => null,
        remaining: () => 0,
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

    if (_contentBuffer.isNotEmpty && state.streamingMsg != null) {
      final partial = SettledMessage(
        id: state.streamingMsg!.id,
        role: 'assistant',
        content: _contentBuffer,
      );
      state = state.copyWith(
        settled: [partial, ...state.settled],
        streamingMsg: () => null,
      );
    } else {
      state = state.copyWith(streamingMsg: () => null);
    }
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
        streamingMsg: () => current.copyWith(content: _contentBuffer),
      );
    }
  }

  void _onDone(Map<String, dynamic>? data) {
    _stopFlushTimer();
    _sseSubscription?.cancel();
    _sseSubscription = null;

    final remaining = data?['remaining'] as int?;

    final assistantMsg = SettledMessage(
      id: data?['message_id']?.toString() ?? state.streamingMsg?.id ?? 'unknown',
      role: 'assistant',
      content: _contentBuffer,
      model: data?['model']?.toString(),
      cost: const MessageCost(total: 0),
    );

    state = state.copyWith(
      settled: [assistantMsg, ...state.settled],
      streamingMsg: () => null,
      remaining: () => remaining ?? state.remaining,
    );
    _contentBuffer = '';
  }

  void _onError(Object error) {
    _stopFlushTimer();
    _sseSubscription?.cancel();
    _sseSubscription = null;

    if (error is DioException && error.type == DioExceptionType.cancel) return;

    if (error is RateLimitException) {
      state = state.copyWith(
        streamingMsg: () => null,
        remaining: () => 0,
      );
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
        streamingMsg: () => null,
        error: () => 'Response interrupted',
      );
    } else {
      final msg = error is NetworkException
          ? 'No internet connection'
          : error.toString();
      state = state.copyWith(
        streamingMsg: () => null,
        error: () => msg,
      );
    }
    _contentBuffer = '';
  }

  @override
  void dispose() {
    _stopFlushTimer();
    _cancelToken?.cancel();
    _sseSubscription?.cancel();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final guestChatNotifierProvider =
    StateNotifierProvider.autoDispose<GuestChatNotifier, GuestChatState>(
  (ref) => GuestChatNotifier(ref),
);
