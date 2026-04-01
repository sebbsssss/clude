// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'conversation.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$ConversationImpl _$$ConversationImplFromJson(Map<String, dynamic> json) =>
    _$ConversationImpl(
      id: json['id'] as String,
      ownerWallet: json['owner_wallet'] as String,
      title: json['title'] as String?,
      model: json['model'] as String,
      messageCount: (json['message_count'] as num).toInt(),
      createdAt: json['created_at'] as String,
      updatedAt: json['updated_at'] as String,
    );

Map<String, dynamic> _$$ConversationImplToJson(_$ConversationImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'owner_wallet': instance.ownerWallet,
      'title': instance.title,
      'model': instance.model,
      'message_count': instance.messageCount,
      'created_at': instance.createdAt,
      'updated_at': instance.updatedAt,
    };

_$ConversationDetailImpl _$$ConversationDetailImplFromJson(
  Map<String, dynamic> json,
) => _$ConversationDetailImpl(
  id: json['id'] as String,
  ownerWallet: json['owner_wallet'] as String,
  title: json['title'] as String?,
  model: json['model'] as String,
  messageCount: (json['message_count'] as num).toInt(),
  createdAt: json['created_at'] as String,
  updatedAt: json['updated_at'] as String,
  messages: (json['messages'] as List<dynamic>)
      .map((e) => Message.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['hasMore'] as bool,
);

Map<String, dynamic> _$$ConversationDetailImplToJson(
  _$ConversationDetailImpl instance,
) => <String, dynamic>{
  'id': instance.id,
  'owner_wallet': instance.ownerWallet,
  'title': instance.title,
  'model': instance.model,
  'message_count': instance.messageCount,
  'created_at': instance.createdAt,
  'updated_at': instance.updatedAt,
  'messages': instance.messages,
  'hasMore': instance.hasMore,
};
