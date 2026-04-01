// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'conversation.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

Conversation _$ConversationFromJson(Map<String, dynamic> json) {
  return _Conversation.fromJson(json);
}

/// @nodoc
mixin _$Conversation {
  String get id => throw _privateConstructorUsedError;
  @JsonKey(name: 'owner_wallet')
  String get ownerWallet => throw _privateConstructorUsedError;
  String? get title => throw _privateConstructorUsedError;
  String get model => throw _privateConstructorUsedError;
  @JsonKey(name: 'message_count')
  int get messageCount => throw _privateConstructorUsedError;
  @JsonKey(name: 'created_at')
  String get createdAt => throw _privateConstructorUsedError;
  @JsonKey(name: 'updated_at')
  String get updatedAt => throw _privateConstructorUsedError;

  /// Serializes this Conversation to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of Conversation
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ConversationCopyWith<Conversation> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ConversationCopyWith<$Res> {
  factory $ConversationCopyWith(
    Conversation value,
    $Res Function(Conversation) then,
  ) = _$ConversationCopyWithImpl<$Res, Conversation>;
  @useResult
  $Res call({
    String id,
    @JsonKey(name: 'owner_wallet') String ownerWallet,
    String? title,
    String model,
    @JsonKey(name: 'message_count') int messageCount,
    @JsonKey(name: 'created_at') String createdAt,
    @JsonKey(name: 'updated_at') String updatedAt,
  });
}

/// @nodoc
class _$ConversationCopyWithImpl<$Res, $Val extends Conversation>
    implements $ConversationCopyWith<$Res> {
  _$ConversationCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of Conversation
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? ownerWallet = null,
    Object? title = freezed,
    Object? model = null,
    Object? messageCount = null,
    Object? createdAt = null,
    Object? updatedAt = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            ownerWallet: null == ownerWallet
                ? _value.ownerWallet
                : ownerWallet // ignore: cast_nullable_to_non_nullable
                      as String,
            title: freezed == title
                ? _value.title
                : title // ignore: cast_nullable_to_non_nullable
                      as String?,
            model: null == model
                ? _value.model
                : model // ignore: cast_nullable_to_non_nullable
                      as String,
            messageCount: null == messageCount
                ? _value.messageCount
                : messageCount // ignore: cast_nullable_to_non_nullable
                      as int,
            createdAt: null == createdAt
                ? _value.createdAt
                : createdAt // ignore: cast_nullable_to_non_nullable
                      as String,
            updatedAt: null == updatedAt
                ? _value.updatedAt
                : updatedAt // ignore: cast_nullable_to_non_nullable
                      as String,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$ConversationImplCopyWith<$Res>
    implements $ConversationCopyWith<$Res> {
  factory _$$ConversationImplCopyWith(
    _$ConversationImpl value,
    $Res Function(_$ConversationImpl) then,
  ) = __$$ConversationImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    @JsonKey(name: 'owner_wallet') String ownerWallet,
    String? title,
    String model,
    @JsonKey(name: 'message_count') int messageCount,
    @JsonKey(name: 'created_at') String createdAt,
    @JsonKey(name: 'updated_at') String updatedAt,
  });
}

/// @nodoc
class __$$ConversationImplCopyWithImpl<$Res>
    extends _$ConversationCopyWithImpl<$Res, _$ConversationImpl>
    implements _$$ConversationImplCopyWith<$Res> {
  __$$ConversationImplCopyWithImpl(
    _$ConversationImpl _value,
    $Res Function(_$ConversationImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of Conversation
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? ownerWallet = null,
    Object? title = freezed,
    Object? model = null,
    Object? messageCount = null,
    Object? createdAt = null,
    Object? updatedAt = null,
  }) {
    return _then(
      _$ConversationImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        ownerWallet: null == ownerWallet
            ? _value.ownerWallet
            : ownerWallet // ignore: cast_nullable_to_non_nullable
                  as String,
        title: freezed == title
            ? _value.title
            : title // ignore: cast_nullable_to_non_nullable
                  as String?,
        model: null == model
            ? _value.model
            : model // ignore: cast_nullable_to_non_nullable
                  as String,
        messageCount: null == messageCount
            ? _value.messageCount
            : messageCount // ignore: cast_nullable_to_non_nullable
                  as int,
        createdAt: null == createdAt
            ? _value.createdAt
            : createdAt // ignore: cast_nullable_to_non_nullable
                  as String,
        updatedAt: null == updatedAt
            ? _value.updatedAt
            : updatedAt // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$ConversationImpl implements _Conversation {
  const _$ConversationImpl({
    required this.id,
    @JsonKey(name: 'owner_wallet') required this.ownerWallet,
    this.title,
    required this.model,
    @JsonKey(name: 'message_count') required this.messageCount,
    @JsonKey(name: 'created_at') required this.createdAt,
    @JsonKey(name: 'updated_at') required this.updatedAt,
  });

  factory _$ConversationImpl.fromJson(Map<String, dynamic> json) =>
      _$$ConversationImplFromJson(json);

  @override
  final String id;
  @override
  @JsonKey(name: 'owner_wallet')
  final String ownerWallet;
  @override
  final String? title;
  @override
  final String model;
  @override
  @JsonKey(name: 'message_count')
  final int messageCount;
  @override
  @JsonKey(name: 'created_at')
  final String createdAt;
  @override
  @JsonKey(name: 'updated_at')
  final String updatedAt;

  @override
  String toString() {
    return 'Conversation(id: $id, ownerWallet: $ownerWallet, title: $title, model: $model, messageCount: $messageCount, createdAt: $createdAt, updatedAt: $updatedAt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ConversationImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.ownerWallet, ownerWallet) ||
                other.ownerWallet == ownerWallet) &&
            (identical(other.title, title) || other.title == title) &&
            (identical(other.model, model) || other.model == model) &&
            (identical(other.messageCount, messageCount) ||
                other.messageCount == messageCount) &&
            (identical(other.createdAt, createdAt) ||
                other.createdAt == createdAt) &&
            (identical(other.updatedAt, updatedAt) ||
                other.updatedAt == updatedAt));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    ownerWallet,
    title,
    model,
    messageCount,
    createdAt,
    updatedAt,
  );

  /// Create a copy of Conversation
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ConversationImplCopyWith<_$ConversationImpl> get copyWith =>
      __$$ConversationImplCopyWithImpl<_$ConversationImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$ConversationImplToJson(this);
  }
}

abstract class _Conversation implements Conversation {
  const factory _Conversation({
    required final String id,
    @JsonKey(name: 'owner_wallet') required final String ownerWallet,
    final String? title,
    required final String model,
    @JsonKey(name: 'message_count') required final int messageCount,
    @JsonKey(name: 'created_at') required final String createdAt,
    @JsonKey(name: 'updated_at') required final String updatedAt,
  }) = _$ConversationImpl;

  factory _Conversation.fromJson(Map<String, dynamic> json) =
      _$ConversationImpl.fromJson;

  @override
  String get id;
  @override
  @JsonKey(name: 'owner_wallet')
  String get ownerWallet;
  @override
  String? get title;
  @override
  String get model;
  @override
  @JsonKey(name: 'message_count')
  int get messageCount;
  @override
  @JsonKey(name: 'created_at')
  String get createdAt;
  @override
  @JsonKey(name: 'updated_at')
  String get updatedAt;

  /// Create a copy of Conversation
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ConversationImplCopyWith<_$ConversationImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

ConversationDetail _$ConversationDetailFromJson(Map<String, dynamic> json) {
  return _ConversationDetail.fromJson(json);
}

/// @nodoc
mixin _$ConversationDetail {
  String get id => throw _privateConstructorUsedError;
  @JsonKey(name: 'owner_wallet')
  String get ownerWallet => throw _privateConstructorUsedError;
  String? get title => throw _privateConstructorUsedError;
  String get model => throw _privateConstructorUsedError;
  @JsonKey(name: 'message_count')
  int get messageCount => throw _privateConstructorUsedError;
  @JsonKey(name: 'created_at')
  String get createdAt => throw _privateConstructorUsedError;
  @JsonKey(name: 'updated_at')
  String get updatedAt => throw _privateConstructorUsedError;
  List<Message> get messages => throw _privateConstructorUsedError;
  @JsonKey(name: 'hasMore')
  bool get hasMore => throw _privateConstructorUsedError;

  /// Serializes this ConversationDetail to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of ConversationDetail
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ConversationDetailCopyWith<ConversationDetail> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ConversationDetailCopyWith<$Res> {
  factory $ConversationDetailCopyWith(
    ConversationDetail value,
    $Res Function(ConversationDetail) then,
  ) = _$ConversationDetailCopyWithImpl<$Res, ConversationDetail>;
  @useResult
  $Res call({
    String id,
    @JsonKey(name: 'owner_wallet') String ownerWallet,
    String? title,
    String model,
    @JsonKey(name: 'message_count') int messageCount,
    @JsonKey(name: 'created_at') String createdAt,
    @JsonKey(name: 'updated_at') String updatedAt,
    List<Message> messages,
    @JsonKey(name: 'hasMore') bool hasMore,
  });
}

/// @nodoc
class _$ConversationDetailCopyWithImpl<$Res, $Val extends ConversationDetail>
    implements $ConversationDetailCopyWith<$Res> {
  _$ConversationDetailCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of ConversationDetail
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? ownerWallet = null,
    Object? title = freezed,
    Object? model = null,
    Object? messageCount = null,
    Object? createdAt = null,
    Object? updatedAt = null,
    Object? messages = null,
    Object? hasMore = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            ownerWallet: null == ownerWallet
                ? _value.ownerWallet
                : ownerWallet // ignore: cast_nullable_to_non_nullable
                      as String,
            title: freezed == title
                ? _value.title
                : title // ignore: cast_nullable_to_non_nullable
                      as String?,
            model: null == model
                ? _value.model
                : model // ignore: cast_nullable_to_non_nullable
                      as String,
            messageCount: null == messageCount
                ? _value.messageCount
                : messageCount // ignore: cast_nullable_to_non_nullable
                      as int,
            createdAt: null == createdAt
                ? _value.createdAt
                : createdAt // ignore: cast_nullable_to_non_nullable
                      as String,
            updatedAt: null == updatedAt
                ? _value.updatedAt
                : updatedAt // ignore: cast_nullable_to_non_nullable
                      as String,
            messages: null == messages
                ? _value.messages
                : messages // ignore: cast_nullable_to_non_nullable
                      as List<Message>,
            hasMore: null == hasMore
                ? _value.hasMore
                : hasMore // ignore: cast_nullable_to_non_nullable
                      as bool,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$ConversationDetailImplCopyWith<$Res>
    implements $ConversationDetailCopyWith<$Res> {
  factory _$$ConversationDetailImplCopyWith(
    _$ConversationDetailImpl value,
    $Res Function(_$ConversationDetailImpl) then,
  ) = __$$ConversationDetailImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    @JsonKey(name: 'owner_wallet') String ownerWallet,
    String? title,
    String model,
    @JsonKey(name: 'message_count') int messageCount,
    @JsonKey(name: 'created_at') String createdAt,
    @JsonKey(name: 'updated_at') String updatedAt,
    List<Message> messages,
    @JsonKey(name: 'hasMore') bool hasMore,
  });
}

/// @nodoc
class __$$ConversationDetailImplCopyWithImpl<$Res>
    extends _$ConversationDetailCopyWithImpl<$Res, _$ConversationDetailImpl>
    implements _$$ConversationDetailImplCopyWith<$Res> {
  __$$ConversationDetailImplCopyWithImpl(
    _$ConversationDetailImpl _value,
    $Res Function(_$ConversationDetailImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of ConversationDetail
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? ownerWallet = null,
    Object? title = freezed,
    Object? model = null,
    Object? messageCount = null,
    Object? createdAt = null,
    Object? updatedAt = null,
    Object? messages = null,
    Object? hasMore = null,
  }) {
    return _then(
      _$ConversationDetailImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        ownerWallet: null == ownerWallet
            ? _value.ownerWallet
            : ownerWallet // ignore: cast_nullable_to_non_nullable
                  as String,
        title: freezed == title
            ? _value.title
            : title // ignore: cast_nullable_to_non_nullable
                  as String?,
        model: null == model
            ? _value.model
            : model // ignore: cast_nullable_to_non_nullable
                  as String,
        messageCount: null == messageCount
            ? _value.messageCount
            : messageCount // ignore: cast_nullable_to_non_nullable
                  as int,
        createdAt: null == createdAt
            ? _value.createdAt
            : createdAt // ignore: cast_nullable_to_non_nullable
                  as String,
        updatedAt: null == updatedAt
            ? _value.updatedAt
            : updatedAt // ignore: cast_nullable_to_non_nullable
                  as String,
        messages: null == messages
            ? _value._messages
            : messages // ignore: cast_nullable_to_non_nullable
                  as List<Message>,
        hasMore: null == hasMore
            ? _value.hasMore
            : hasMore // ignore: cast_nullable_to_non_nullable
                  as bool,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$ConversationDetailImpl implements _ConversationDetail {
  const _$ConversationDetailImpl({
    required this.id,
    @JsonKey(name: 'owner_wallet') required this.ownerWallet,
    this.title,
    required this.model,
    @JsonKey(name: 'message_count') required this.messageCount,
    @JsonKey(name: 'created_at') required this.createdAt,
    @JsonKey(name: 'updated_at') required this.updatedAt,
    required final List<Message> messages,
    @JsonKey(name: 'hasMore') required this.hasMore,
  }) : _messages = messages;

  factory _$ConversationDetailImpl.fromJson(Map<String, dynamic> json) =>
      _$$ConversationDetailImplFromJson(json);

  @override
  final String id;
  @override
  @JsonKey(name: 'owner_wallet')
  final String ownerWallet;
  @override
  final String? title;
  @override
  final String model;
  @override
  @JsonKey(name: 'message_count')
  final int messageCount;
  @override
  @JsonKey(name: 'created_at')
  final String createdAt;
  @override
  @JsonKey(name: 'updated_at')
  final String updatedAt;
  final List<Message> _messages;
  @override
  List<Message> get messages {
    if (_messages is EqualUnmodifiableListView) return _messages;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_messages);
  }

  @override
  @JsonKey(name: 'hasMore')
  final bool hasMore;

  @override
  String toString() {
    return 'ConversationDetail(id: $id, ownerWallet: $ownerWallet, title: $title, model: $model, messageCount: $messageCount, createdAt: $createdAt, updatedAt: $updatedAt, messages: $messages, hasMore: $hasMore)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ConversationDetailImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.ownerWallet, ownerWallet) ||
                other.ownerWallet == ownerWallet) &&
            (identical(other.title, title) || other.title == title) &&
            (identical(other.model, model) || other.model == model) &&
            (identical(other.messageCount, messageCount) ||
                other.messageCount == messageCount) &&
            (identical(other.createdAt, createdAt) ||
                other.createdAt == createdAt) &&
            (identical(other.updatedAt, updatedAt) ||
                other.updatedAt == updatedAt) &&
            const DeepCollectionEquality().equals(other._messages, _messages) &&
            (identical(other.hasMore, hasMore) || other.hasMore == hasMore));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    ownerWallet,
    title,
    model,
    messageCount,
    createdAt,
    updatedAt,
    const DeepCollectionEquality().hash(_messages),
    hasMore,
  );

  /// Create a copy of ConversationDetail
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ConversationDetailImplCopyWith<_$ConversationDetailImpl> get copyWith =>
      __$$ConversationDetailImplCopyWithImpl<_$ConversationDetailImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$ConversationDetailImplToJson(this);
  }
}

abstract class _ConversationDetail implements ConversationDetail {
  const factory _ConversationDetail({
    required final String id,
    @JsonKey(name: 'owner_wallet') required final String ownerWallet,
    final String? title,
    required final String model,
    @JsonKey(name: 'message_count') required final int messageCount,
    @JsonKey(name: 'created_at') required final String createdAt,
    @JsonKey(name: 'updated_at') required final String updatedAt,
    required final List<Message> messages,
    @JsonKey(name: 'hasMore') required final bool hasMore,
  }) = _$ConversationDetailImpl;

  factory _ConversationDetail.fromJson(Map<String, dynamic> json) =
      _$ConversationDetailImpl.fromJson;

  @override
  String get id;
  @override
  @JsonKey(name: 'owner_wallet')
  String get ownerWallet;
  @override
  String? get title;
  @override
  String get model;
  @override
  @JsonKey(name: 'message_count')
  int get messageCount;
  @override
  @JsonKey(name: 'created_at')
  String get createdAt;
  @override
  @JsonKey(name: 'updated_at')
  String get updatedAt;
  @override
  List<Message> get messages;
  @override
  @JsonKey(name: 'hasMore')
  bool get hasMore;

  /// Create a copy of ConversationDetail
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ConversationDetailImplCopyWith<_$ConversationDetailImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
