// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'display_message.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

/// @nodoc
mixin _$MessageCost {
  double get total => throw _privateConstructorUsedError;
  double get input => throw _privateConstructorUsedError;
  double get output => throw _privateConstructorUsedError;

  /// Create a copy of MessageCost
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $MessageCostCopyWith<MessageCost> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $MessageCostCopyWith<$Res> {
  factory $MessageCostCopyWith(
    MessageCost value,
    $Res Function(MessageCost) then,
  ) = _$MessageCostCopyWithImpl<$Res, MessageCost>;
  @useResult
  $Res call({double total, double input, double output});
}

/// @nodoc
class _$MessageCostCopyWithImpl<$Res, $Val extends MessageCost>
    implements $MessageCostCopyWith<$Res> {
  _$MessageCostCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of MessageCost
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? total = null,
    Object? input = null,
    Object? output = null,
  }) {
    return _then(
      _value.copyWith(
            total: null == total
                ? _value.total
                : total // ignore: cast_nullable_to_non_nullable
                      as double,
            input: null == input
                ? _value.input
                : input // ignore: cast_nullable_to_non_nullable
                      as double,
            output: null == output
                ? _value.output
                : output // ignore: cast_nullable_to_non_nullable
                      as double,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$MessageCostImplCopyWith<$Res>
    implements $MessageCostCopyWith<$Res> {
  factory _$$MessageCostImplCopyWith(
    _$MessageCostImpl value,
    $Res Function(_$MessageCostImpl) then,
  ) = __$$MessageCostImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({double total, double input, double output});
}

/// @nodoc
class __$$MessageCostImplCopyWithImpl<$Res>
    extends _$MessageCostCopyWithImpl<$Res, _$MessageCostImpl>
    implements _$$MessageCostImplCopyWith<$Res> {
  __$$MessageCostImplCopyWithImpl(
    _$MessageCostImpl _value,
    $Res Function(_$MessageCostImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of MessageCost
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? total = null,
    Object? input = null,
    Object? output = null,
  }) {
    return _then(
      _$MessageCostImpl(
        total: null == total
            ? _value.total
            : total // ignore: cast_nullable_to_non_nullable
                  as double,
        input: null == input
            ? _value.input
            : input // ignore: cast_nullable_to_non_nullable
                  as double,
        output: null == output
            ? _value.output
            : output // ignore: cast_nullable_to_non_nullable
                  as double,
      ),
    );
  }
}

/// @nodoc

class _$MessageCostImpl implements _MessageCost {
  const _$MessageCostImpl({
    required this.total,
    this.input = 0,
    this.output = 0,
  });

  @override
  final double total;
  @override
  @JsonKey()
  final double input;
  @override
  @JsonKey()
  final double output;

  @override
  String toString() {
    return 'MessageCost(total: $total, input: $input, output: $output)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$MessageCostImpl &&
            (identical(other.total, total) || other.total == total) &&
            (identical(other.input, input) || other.input == input) &&
            (identical(other.output, output) || other.output == output));
  }

  @override
  int get hashCode => Object.hash(runtimeType, total, input, output);

  /// Create a copy of MessageCost
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$MessageCostImplCopyWith<_$MessageCostImpl> get copyWith =>
      __$$MessageCostImplCopyWithImpl<_$MessageCostImpl>(this, _$identity);
}

abstract class _MessageCost implements MessageCost {
  const factory _MessageCost({
    required final double total,
    final double input,
    final double output,
  }) = _$MessageCostImpl;

  @override
  double get total;
  @override
  double get input;
  @override
  double get output;

  /// Create a copy of MessageCost
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$MessageCostImplCopyWith<_$MessageCostImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
mixin _$MessageTokens {
  int get prompt => throw _privateConstructorUsedError;
  int get completion => throw _privateConstructorUsedError;

  /// Create a copy of MessageTokens
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $MessageTokensCopyWith<MessageTokens> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $MessageTokensCopyWith<$Res> {
  factory $MessageTokensCopyWith(
    MessageTokens value,
    $Res Function(MessageTokens) then,
  ) = _$MessageTokensCopyWithImpl<$Res, MessageTokens>;
  @useResult
  $Res call({int prompt, int completion});
}

/// @nodoc
class _$MessageTokensCopyWithImpl<$Res, $Val extends MessageTokens>
    implements $MessageTokensCopyWith<$Res> {
  _$MessageTokensCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of MessageTokens
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? prompt = null, Object? completion = null}) {
    return _then(
      _value.copyWith(
            prompt: null == prompt
                ? _value.prompt
                : prompt // ignore: cast_nullable_to_non_nullable
                      as int,
            completion: null == completion
                ? _value.completion
                : completion // ignore: cast_nullable_to_non_nullable
                      as int,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$MessageTokensImplCopyWith<$Res>
    implements $MessageTokensCopyWith<$Res> {
  factory _$$MessageTokensImplCopyWith(
    _$MessageTokensImpl value,
    $Res Function(_$MessageTokensImpl) then,
  ) = __$$MessageTokensImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({int prompt, int completion});
}

/// @nodoc
class __$$MessageTokensImplCopyWithImpl<$Res>
    extends _$MessageTokensCopyWithImpl<$Res, _$MessageTokensImpl>
    implements _$$MessageTokensImplCopyWith<$Res> {
  __$$MessageTokensImplCopyWithImpl(
    _$MessageTokensImpl _value,
    $Res Function(_$MessageTokensImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of MessageTokens
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? prompt = null, Object? completion = null}) {
    return _then(
      _$MessageTokensImpl(
        prompt: null == prompt
            ? _value.prompt
            : prompt // ignore: cast_nullable_to_non_nullable
                  as int,
        completion: null == completion
            ? _value.completion
            : completion // ignore: cast_nullable_to_non_nullable
                  as int,
      ),
    );
  }
}

/// @nodoc

class _$MessageTokensImpl implements _MessageTokens {
  const _$MessageTokensImpl({required this.prompt, required this.completion});

  @override
  final int prompt;
  @override
  final int completion;

  @override
  String toString() {
    return 'MessageTokens(prompt: $prompt, completion: $completion)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$MessageTokensImpl &&
            (identical(other.prompt, prompt) || other.prompt == prompt) &&
            (identical(other.completion, completion) ||
                other.completion == completion));
  }

  @override
  int get hashCode => Object.hash(runtimeType, prompt, completion);

  /// Create a copy of MessageTokens
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$MessageTokensImplCopyWith<_$MessageTokensImpl> get copyWith =>
      __$$MessageTokensImplCopyWithImpl<_$MessageTokensImpl>(this, _$identity);
}

abstract class _MessageTokens implements MessageTokens {
  const factory _MessageTokens({
    required final int prompt,
    required final int completion,
  }) = _$MessageTokensImpl;

  @override
  int get prompt;
  @override
  int get completion;

  /// Create a copy of MessageTokens
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$MessageTokensImplCopyWith<_$MessageTokensImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
mixin _$DisplayMessage {
  String get id => throw _privateConstructorUsedError;
  String get content => throw _privateConstructorUsedError;
  bool get isGreeting => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
      String id,
      String role,
      String content,
      List<int>? memoryIds,
      String? model,
      MessageCost? cost,
      MessageTokens? tokens,
      MessageReceipt? receipt,
      bool isGreeting,
      GreetingMeta? greetingMeta,
    )
    settled,
    required TResult Function(String id, String content, bool isGreeting)
    streaming,
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(
      String id,
      String role,
      String content,
      List<int>? memoryIds,
      String? model,
      MessageCost? cost,
      MessageTokens? tokens,
      MessageReceipt? receipt,
      bool isGreeting,
      GreetingMeta? greetingMeta,
    )?
    settled,
    TResult? Function(String id, String content, bool isGreeting)? streaming,
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(
      String id,
      String role,
      String content,
      List<int>? memoryIds,
      String? model,
      MessageCost? cost,
      MessageTokens? tokens,
      MessageReceipt? receipt,
      bool isGreeting,
      GreetingMeta? greetingMeta,
    )?
    settled,
    TResult Function(String id, String content, bool isGreeting)? streaming,
    required TResult orElse(),
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(SettledMessage value) settled,
    required TResult Function(StreamingMessage value) streaming,
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(SettledMessage value)? settled,
    TResult? Function(StreamingMessage value)? streaming,
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(SettledMessage value)? settled,
    TResult Function(StreamingMessage value)? streaming,
    required TResult orElse(),
  }) => throw _privateConstructorUsedError;

  /// Create a copy of DisplayMessage
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $DisplayMessageCopyWith<DisplayMessage> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $DisplayMessageCopyWith<$Res> {
  factory $DisplayMessageCopyWith(
    DisplayMessage value,
    $Res Function(DisplayMessage) then,
  ) = _$DisplayMessageCopyWithImpl<$Res, DisplayMessage>;
  @useResult
  $Res call({String id, String content, bool isGreeting});
}

/// @nodoc
class _$DisplayMessageCopyWithImpl<$Res, $Val extends DisplayMessage>
    implements $DisplayMessageCopyWith<$Res> {
  _$DisplayMessageCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of DisplayMessage
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? content = null,
    Object? isGreeting = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            content: null == content
                ? _value.content
                : content // ignore: cast_nullable_to_non_nullable
                      as String,
            isGreeting: null == isGreeting
                ? _value.isGreeting
                : isGreeting // ignore: cast_nullable_to_non_nullable
                      as bool,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$SettledMessageImplCopyWith<$Res>
    implements $DisplayMessageCopyWith<$Res> {
  factory _$$SettledMessageImplCopyWith(
    _$SettledMessageImpl value,
    $Res Function(_$SettledMessageImpl) then,
  ) = __$$SettledMessageImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String role,
    String content,
    List<int>? memoryIds,
    String? model,
    MessageCost? cost,
    MessageTokens? tokens,
    MessageReceipt? receipt,
    bool isGreeting,
    GreetingMeta? greetingMeta,
  });

  $MessageCostCopyWith<$Res>? get cost;
  $MessageTokensCopyWith<$Res>? get tokens;
  $MessageReceiptCopyWith<$Res>? get receipt;
  $GreetingMetaCopyWith<$Res>? get greetingMeta;
}

/// @nodoc
class __$$SettledMessageImplCopyWithImpl<$Res>
    extends _$DisplayMessageCopyWithImpl<$Res, _$SettledMessageImpl>
    implements _$$SettledMessageImplCopyWith<$Res> {
  __$$SettledMessageImplCopyWithImpl(
    _$SettledMessageImpl _value,
    $Res Function(_$SettledMessageImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of DisplayMessage
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? role = null,
    Object? content = null,
    Object? memoryIds = freezed,
    Object? model = freezed,
    Object? cost = freezed,
    Object? tokens = freezed,
    Object? receipt = freezed,
    Object? isGreeting = null,
    Object? greetingMeta = freezed,
  }) {
    return _then(
      _$SettledMessageImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        role: null == role
            ? _value.role
            : role // ignore: cast_nullable_to_non_nullable
                  as String,
        content: null == content
            ? _value.content
            : content // ignore: cast_nullable_to_non_nullable
                  as String,
        memoryIds: freezed == memoryIds
            ? _value._memoryIds
            : memoryIds // ignore: cast_nullable_to_non_nullable
                  as List<int>?,
        model: freezed == model
            ? _value.model
            : model // ignore: cast_nullable_to_non_nullable
                  as String?,
        cost: freezed == cost
            ? _value.cost
            : cost // ignore: cast_nullable_to_non_nullable
                  as MessageCost?,
        tokens: freezed == tokens
            ? _value.tokens
            : tokens // ignore: cast_nullable_to_non_nullable
                  as MessageTokens?,
        receipt: freezed == receipt
            ? _value.receipt
            : receipt // ignore: cast_nullable_to_non_nullable
                  as MessageReceipt?,
        isGreeting: null == isGreeting
            ? _value.isGreeting
            : isGreeting // ignore: cast_nullable_to_non_nullable
                  as bool,
        greetingMeta: freezed == greetingMeta
            ? _value.greetingMeta
            : greetingMeta // ignore: cast_nullable_to_non_nullable
                  as GreetingMeta?,
      ),
    );
  }

  /// Create a copy of DisplayMessage
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $MessageCostCopyWith<$Res>? get cost {
    if (_value.cost == null) {
      return null;
    }

    return $MessageCostCopyWith<$Res>(_value.cost!, (value) {
      return _then(_value.copyWith(cost: value));
    });
  }

  /// Create a copy of DisplayMessage
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $MessageTokensCopyWith<$Res>? get tokens {
    if (_value.tokens == null) {
      return null;
    }

    return $MessageTokensCopyWith<$Res>(_value.tokens!, (value) {
      return _then(_value.copyWith(tokens: value));
    });
  }

  /// Create a copy of DisplayMessage
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $MessageReceiptCopyWith<$Res>? get receipt {
    if (_value.receipt == null) {
      return null;
    }

    return $MessageReceiptCopyWith<$Res>(_value.receipt!, (value) {
      return _then(_value.copyWith(receipt: value));
    });
  }

  /// Create a copy of DisplayMessage
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $GreetingMetaCopyWith<$Res>? get greetingMeta {
    if (_value.greetingMeta == null) {
      return null;
    }

    return $GreetingMetaCopyWith<$Res>(_value.greetingMeta!, (value) {
      return _then(_value.copyWith(greetingMeta: value));
    });
  }
}

/// @nodoc

class _$SettledMessageImpl implements SettledMessage {
  const _$SettledMessageImpl({
    required this.id,
    required this.role,
    required this.content,
    final List<int>? memoryIds,
    this.model,
    this.cost,
    this.tokens,
    this.receipt,
    this.isGreeting = false,
    this.greetingMeta,
  }) : _memoryIds = memoryIds;

  @override
  final String id;
  @override
  final String role;
  @override
  final String content;
  final List<int>? _memoryIds;
  @override
  List<int>? get memoryIds {
    final value = _memoryIds;
    if (value == null) return null;
    if (_memoryIds is EqualUnmodifiableListView) return _memoryIds;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(value);
  }

  @override
  final String? model;
  @override
  final MessageCost? cost;
  @override
  final MessageTokens? tokens;
  @override
  final MessageReceipt? receipt;
  @override
  @JsonKey()
  final bool isGreeting;
  @override
  final GreetingMeta? greetingMeta;

  @override
  String toString() {
    return 'DisplayMessage.settled(id: $id, role: $role, content: $content, memoryIds: $memoryIds, model: $model, cost: $cost, tokens: $tokens, receipt: $receipt, isGreeting: $isGreeting, greetingMeta: $greetingMeta)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$SettledMessageImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.role, role) || other.role == role) &&
            (identical(other.content, content) || other.content == content) &&
            const DeepCollectionEquality().equals(
              other._memoryIds,
              _memoryIds,
            ) &&
            (identical(other.model, model) || other.model == model) &&
            (identical(other.cost, cost) || other.cost == cost) &&
            (identical(other.tokens, tokens) || other.tokens == tokens) &&
            (identical(other.receipt, receipt) || other.receipt == receipt) &&
            (identical(other.isGreeting, isGreeting) ||
                other.isGreeting == isGreeting) &&
            (identical(other.greetingMeta, greetingMeta) ||
                other.greetingMeta == greetingMeta));
  }

  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    role,
    content,
    const DeepCollectionEquality().hash(_memoryIds),
    model,
    cost,
    tokens,
    receipt,
    isGreeting,
    greetingMeta,
  );

  /// Create a copy of DisplayMessage
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$SettledMessageImplCopyWith<_$SettledMessageImpl> get copyWith =>
      __$$SettledMessageImplCopyWithImpl<_$SettledMessageImpl>(
        this,
        _$identity,
      );

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
      String id,
      String role,
      String content,
      List<int>? memoryIds,
      String? model,
      MessageCost? cost,
      MessageTokens? tokens,
      MessageReceipt? receipt,
      bool isGreeting,
      GreetingMeta? greetingMeta,
    )
    settled,
    required TResult Function(String id, String content, bool isGreeting)
    streaming,
  }) {
    return settled(
      id,
      role,
      content,
      memoryIds,
      model,
      cost,
      tokens,
      receipt,
      isGreeting,
      greetingMeta,
    );
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(
      String id,
      String role,
      String content,
      List<int>? memoryIds,
      String? model,
      MessageCost? cost,
      MessageTokens? tokens,
      MessageReceipt? receipt,
      bool isGreeting,
      GreetingMeta? greetingMeta,
    )?
    settled,
    TResult? Function(String id, String content, bool isGreeting)? streaming,
  }) {
    return settled?.call(
      id,
      role,
      content,
      memoryIds,
      model,
      cost,
      tokens,
      receipt,
      isGreeting,
      greetingMeta,
    );
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(
      String id,
      String role,
      String content,
      List<int>? memoryIds,
      String? model,
      MessageCost? cost,
      MessageTokens? tokens,
      MessageReceipt? receipt,
      bool isGreeting,
      GreetingMeta? greetingMeta,
    )?
    settled,
    TResult Function(String id, String content, bool isGreeting)? streaming,
    required TResult orElse(),
  }) {
    if (settled != null) {
      return settled(
        id,
        role,
        content,
        memoryIds,
        model,
        cost,
        tokens,
        receipt,
        isGreeting,
        greetingMeta,
      );
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(SettledMessage value) settled,
    required TResult Function(StreamingMessage value) streaming,
  }) {
    return settled(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(SettledMessage value)? settled,
    TResult? Function(StreamingMessage value)? streaming,
  }) {
    return settled?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(SettledMessage value)? settled,
    TResult Function(StreamingMessage value)? streaming,
    required TResult orElse(),
  }) {
    if (settled != null) {
      return settled(this);
    }
    return orElse();
  }
}

abstract class SettledMessage implements DisplayMessage {
  const factory SettledMessage({
    required final String id,
    required final String role,
    required final String content,
    final List<int>? memoryIds,
    final String? model,
    final MessageCost? cost,
    final MessageTokens? tokens,
    final MessageReceipt? receipt,
    final bool isGreeting,
    final GreetingMeta? greetingMeta,
  }) = _$SettledMessageImpl;

  @override
  String get id;
  String get role;
  @override
  String get content;
  List<int>? get memoryIds;
  String? get model;
  MessageCost? get cost;
  MessageTokens? get tokens;
  MessageReceipt? get receipt;
  @override
  bool get isGreeting;
  GreetingMeta? get greetingMeta;

  /// Create a copy of DisplayMessage
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$SettledMessageImplCopyWith<_$SettledMessageImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$StreamingMessageImplCopyWith<$Res>
    implements $DisplayMessageCopyWith<$Res> {
  factory _$$StreamingMessageImplCopyWith(
    _$StreamingMessageImpl value,
    $Res Function(_$StreamingMessageImpl) then,
  ) = __$$StreamingMessageImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String id, String content, bool isGreeting});
}

/// @nodoc
class __$$StreamingMessageImplCopyWithImpl<$Res>
    extends _$DisplayMessageCopyWithImpl<$Res, _$StreamingMessageImpl>
    implements _$$StreamingMessageImplCopyWith<$Res> {
  __$$StreamingMessageImplCopyWithImpl(
    _$StreamingMessageImpl _value,
    $Res Function(_$StreamingMessageImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of DisplayMessage
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? content = null,
    Object? isGreeting = null,
  }) {
    return _then(
      _$StreamingMessageImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        content: null == content
            ? _value.content
            : content // ignore: cast_nullable_to_non_nullable
                  as String,
        isGreeting: null == isGreeting
            ? _value.isGreeting
            : isGreeting // ignore: cast_nullable_to_non_nullable
                  as bool,
      ),
    );
  }
}

/// @nodoc

class _$StreamingMessageImpl implements StreamingMessage {
  const _$StreamingMessageImpl({
    required this.id,
    required this.content,
    this.isGreeting = false,
  });

  @override
  final String id;
  @override
  final String content;
  @override
  @JsonKey()
  final bool isGreeting;

  @override
  String toString() {
    return 'DisplayMessage.streaming(id: $id, content: $content, isGreeting: $isGreeting)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$StreamingMessageImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.content, content) || other.content == content) &&
            (identical(other.isGreeting, isGreeting) ||
                other.isGreeting == isGreeting));
  }

  @override
  int get hashCode => Object.hash(runtimeType, id, content, isGreeting);

  /// Create a copy of DisplayMessage
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$StreamingMessageImplCopyWith<_$StreamingMessageImpl> get copyWith =>
      __$$StreamingMessageImplCopyWithImpl<_$StreamingMessageImpl>(
        this,
        _$identity,
      );

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
      String id,
      String role,
      String content,
      List<int>? memoryIds,
      String? model,
      MessageCost? cost,
      MessageTokens? tokens,
      MessageReceipt? receipt,
      bool isGreeting,
      GreetingMeta? greetingMeta,
    )
    settled,
    required TResult Function(String id, String content, bool isGreeting)
    streaming,
  }) {
    return streaming(id, content, isGreeting);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(
      String id,
      String role,
      String content,
      List<int>? memoryIds,
      String? model,
      MessageCost? cost,
      MessageTokens? tokens,
      MessageReceipt? receipt,
      bool isGreeting,
      GreetingMeta? greetingMeta,
    )?
    settled,
    TResult? Function(String id, String content, bool isGreeting)? streaming,
  }) {
    return streaming?.call(id, content, isGreeting);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(
      String id,
      String role,
      String content,
      List<int>? memoryIds,
      String? model,
      MessageCost? cost,
      MessageTokens? tokens,
      MessageReceipt? receipt,
      bool isGreeting,
      GreetingMeta? greetingMeta,
    )?
    settled,
    TResult Function(String id, String content, bool isGreeting)? streaming,
    required TResult orElse(),
  }) {
    if (streaming != null) {
      return streaming(id, content, isGreeting);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(SettledMessage value) settled,
    required TResult Function(StreamingMessage value) streaming,
  }) {
    return streaming(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(SettledMessage value)? settled,
    TResult? Function(StreamingMessage value)? streaming,
  }) {
    return streaming?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(SettledMessage value)? settled,
    TResult Function(StreamingMessage value)? streaming,
    required TResult orElse(),
  }) {
    if (streaming != null) {
      return streaming(this);
    }
    return orElse();
  }
}

abstract class StreamingMessage implements DisplayMessage {
  const factory StreamingMessage({
    required final String id,
    required final String content,
    final bool isGreeting,
  }) = _$StreamingMessageImpl;

  @override
  String get id;
  @override
  String get content;
  @override
  bool get isGreeting;

  /// Create a copy of DisplayMessage
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$StreamingMessageImplCopyWith<_$StreamingMessageImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
