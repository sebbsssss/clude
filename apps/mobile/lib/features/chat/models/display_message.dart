import 'package:freezed_annotation/freezed_annotation.dart';

import '../../../core/api/models/message.dart';
import '../../../core/api/models/responses.dart';

part 'display_message.freezed.dart';

@freezed
class MessageCost with _$MessageCost {
  const factory MessageCost({
    required double total,
    @Default(0) double input,
    @Default(0) double output,
  }) = _MessageCost;
}

@freezed
class MessageTokens with _$MessageTokens {
  const factory MessageTokens({
    required int prompt,
    required int completion,
  }) = _MessageTokens;
}

@freezed
sealed class DisplayMessage with _$DisplayMessage {
  const factory DisplayMessage.settled({
    required String id,
    required String role,
    required String content,
    List<int>? memoryIds,
    String? model,
    MessageCost? cost,
    MessageTokens? tokens,
    MessageReceipt? receipt,
    @Default(false) bool isGreeting,
    GreetingMeta? greetingMeta,
  }) = SettledMessage;

  const factory DisplayMessage.streaming({
    required String id,
    required String content,
    @Default(false) bool isGreeting,
  }) = StreamingMessage;
}

SettledMessage settledFromMessage(Message m) => SettledMessage(
      id: m.id,
      role: m.role,
      content: m.content,
      memoryIds: m.memoryIds,
      model: m.model,
    );
