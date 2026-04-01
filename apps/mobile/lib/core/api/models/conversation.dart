import 'package:freezed_annotation/freezed_annotation.dart';

import 'message.dart';

part 'conversation.freezed.dart';
part 'conversation.g.dart';

@freezed
class Conversation with _$Conversation {
  const factory Conversation({
    required String id,
    @JsonKey(name: 'owner_wallet') required String ownerWallet,
    String? title,
    required String model,
    @JsonKey(name: 'message_count') required int messageCount,
    @JsonKey(name: 'created_at') required String createdAt,
    @JsonKey(name: 'updated_at') required String updatedAt,
  }) = _Conversation;

  factory Conversation.fromJson(Map<String, dynamic> json) =>
      _$ConversationFromJson(json);
}

@freezed
class ConversationDetail with _$ConversationDetail {
  const factory ConversationDetail({
    required String id,
    @JsonKey(name: 'owner_wallet') required String ownerWallet,
    String? title,
    required String model,
    @JsonKey(name: 'message_count') required int messageCount,
    @JsonKey(name: 'created_at') required String createdAt,
    @JsonKey(name: 'updated_at') required String updatedAt,
    required List<Message> messages,
    @JsonKey(name: 'hasMore') required bool hasMore,
  }) = _ConversationDetail;

  factory ConversationDetail.fromJson(Map<String, dynamic> json) =>
      _$ConversationDetailFromJson(json);
}
