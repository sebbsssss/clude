// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'topup_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

/// @nodoc
mixin _$TopupState {
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function() idle,
    required TResult Function() creatingIntent,
    required TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )
    awaitingPayment,
    required TResult Function(double newBalance) confirmed,
    required TResult Function(String message) error,
    required TResult Function() timedOut,
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function()? idle,
    TResult? Function()? creatingIntent,
    TResult? Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult? Function(double newBalance)? confirmed,
    TResult? Function(String message)? error,
    TResult? Function()? timedOut,
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function()? idle,
    TResult Function()? creatingIntent,
    TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult Function(double newBalance)? confirmed,
    TResult Function(String message)? error,
    TResult Function()? timedOut,
    required TResult orElse(),
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(TopupIdle value) idle,
    required TResult Function(TopupCreatingIntent value) creatingIntent,
    required TResult Function(TopupAwaitingPayment value) awaitingPayment,
    required TResult Function(TopupConfirmed value) confirmed,
    required TResult Function(TopupError value) error,
    required TResult Function(TopupTimedOut value) timedOut,
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(TopupIdle value)? idle,
    TResult? Function(TopupCreatingIntent value)? creatingIntent,
    TResult? Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult? Function(TopupConfirmed value)? confirmed,
    TResult? Function(TopupError value)? error,
    TResult? Function(TopupTimedOut value)? timedOut,
  }) => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(TopupIdle value)? idle,
    TResult Function(TopupCreatingIntent value)? creatingIntent,
    TResult Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult Function(TopupConfirmed value)? confirmed,
    TResult Function(TopupError value)? error,
    TResult Function(TopupTimedOut value)? timedOut,
    required TResult orElse(),
  }) => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $TopupStateCopyWith<$Res> {
  factory $TopupStateCopyWith(
    TopupState value,
    $Res Function(TopupState) then,
  ) = _$TopupStateCopyWithImpl<$Res, TopupState>;
}

/// @nodoc
class _$TopupStateCopyWithImpl<$Res, $Val extends TopupState>
    implements $TopupStateCopyWith<$Res> {
  _$TopupStateCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
}

/// @nodoc
abstract class _$$TopupIdleImplCopyWith<$Res> {
  factory _$$TopupIdleImplCopyWith(
    _$TopupIdleImpl value,
    $Res Function(_$TopupIdleImpl) then,
  ) = __$$TopupIdleImplCopyWithImpl<$Res>;
}

/// @nodoc
class __$$TopupIdleImplCopyWithImpl<$Res>
    extends _$TopupStateCopyWithImpl<$Res, _$TopupIdleImpl>
    implements _$$TopupIdleImplCopyWith<$Res> {
  __$$TopupIdleImplCopyWithImpl(
    _$TopupIdleImpl _value,
    $Res Function(_$TopupIdleImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
}

/// @nodoc

class _$TopupIdleImpl implements TopupIdle {
  const _$TopupIdleImpl();

  @override
  String toString() {
    return 'TopupState.idle()';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is _$TopupIdleImpl);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function() idle,
    required TResult Function() creatingIntent,
    required TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )
    awaitingPayment,
    required TResult Function(double newBalance) confirmed,
    required TResult Function(String message) error,
    required TResult Function() timedOut,
  }) {
    return idle();
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function()? idle,
    TResult? Function()? creatingIntent,
    TResult? Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult? Function(double newBalance)? confirmed,
    TResult? Function(String message)? error,
    TResult? Function()? timedOut,
  }) {
    return idle?.call();
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function()? idle,
    TResult Function()? creatingIntent,
    TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult Function(double newBalance)? confirmed,
    TResult Function(String message)? error,
    TResult Function()? timedOut,
    required TResult orElse(),
  }) {
    if (idle != null) {
      return idle();
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(TopupIdle value) idle,
    required TResult Function(TopupCreatingIntent value) creatingIntent,
    required TResult Function(TopupAwaitingPayment value) awaitingPayment,
    required TResult Function(TopupConfirmed value) confirmed,
    required TResult Function(TopupError value) error,
    required TResult Function(TopupTimedOut value) timedOut,
  }) {
    return idle(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(TopupIdle value)? idle,
    TResult? Function(TopupCreatingIntent value)? creatingIntent,
    TResult? Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult? Function(TopupConfirmed value)? confirmed,
    TResult? Function(TopupError value)? error,
    TResult? Function(TopupTimedOut value)? timedOut,
  }) {
    return idle?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(TopupIdle value)? idle,
    TResult Function(TopupCreatingIntent value)? creatingIntent,
    TResult Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult Function(TopupConfirmed value)? confirmed,
    TResult Function(TopupError value)? error,
    TResult Function(TopupTimedOut value)? timedOut,
    required TResult orElse(),
  }) {
    if (idle != null) {
      return idle(this);
    }
    return orElse();
  }
}

abstract class TopupIdle implements TopupState {
  const factory TopupIdle() = _$TopupIdleImpl;
}

/// @nodoc
abstract class _$$TopupCreatingIntentImplCopyWith<$Res> {
  factory _$$TopupCreatingIntentImplCopyWith(
    _$TopupCreatingIntentImpl value,
    $Res Function(_$TopupCreatingIntentImpl) then,
  ) = __$$TopupCreatingIntentImplCopyWithImpl<$Res>;
}

/// @nodoc
class __$$TopupCreatingIntentImplCopyWithImpl<$Res>
    extends _$TopupStateCopyWithImpl<$Res, _$TopupCreatingIntentImpl>
    implements _$$TopupCreatingIntentImplCopyWith<$Res> {
  __$$TopupCreatingIntentImplCopyWithImpl(
    _$TopupCreatingIntentImpl _value,
    $Res Function(_$TopupCreatingIntentImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
}

/// @nodoc

class _$TopupCreatingIntentImpl implements TopupCreatingIntent {
  const _$TopupCreatingIntentImpl();

  @override
  String toString() {
    return 'TopupState.creatingIntent()';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$TopupCreatingIntentImpl);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function() idle,
    required TResult Function() creatingIntent,
    required TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )
    awaitingPayment,
    required TResult Function(double newBalance) confirmed,
    required TResult Function(String message) error,
    required TResult Function() timedOut,
  }) {
    return creatingIntent();
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function()? idle,
    TResult? Function()? creatingIntent,
    TResult? Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult? Function(double newBalance)? confirmed,
    TResult? Function(String message)? error,
    TResult? Function()? timedOut,
  }) {
    return creatingIntent?.call();
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function()? idle,
    TResult Function()? creatingIntent,
    TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult Function(double newBalance)? confirmed,
    TResult Function(String message)? error,
    TResult Function()? timedOut,
    required TResult orElse(),
  }) {
    if (creatingIntent != null) {
      return creatingIntent();
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(TopupIdle value) idle,
    required TResult Function(TopupCreatingIntent value) creatingIntent,
    required TResult Function(TopupAwaitingPayment value) awaitingPayment,
    required TResult Function(TopupConfirmed value) confirmed,
    required TResult Function(TopupError value) error,
    required TResult Function(TopupTimedOut value) timedOut,
  }) {
    return creatingIntent(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(TopupIdle value)? idle,
    TResult? Function(TopupCreatingIntent value)? creatingIntent,
    TResult? Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult? Function(TopupConfirmed value)? confirmed,
    TResult? Function(TopupError value)? error,
    TResult? Function(TopupTimedOut value)? timedOut,
  }) {
    return creatingIntent?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(TopupIdle value)? idle,
    TResult Function(TopupCreatingIntent value)? creatingIntent,
    TResult Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult Function(TopupConfirmed value)? confirmed,
    TResult Function(TopupError value)? error,
    TResult Function(TopupTimedOut value)? timedOut,
    required TResult orElse(),
  }) {
    if (creatingIntent != null) {
      return creatingIntent(this);
    }
    return orElse();
  }
}

abstract class TopupCreatingIntent implements TopupState {
  const factory TopupCreatingIntent() = _$TopupCreatingIntentImpl;
}

/// @nodoc
abstract class _$$TopupAwaitingPaymentImplCopyWith<$Res> {
  factory _$$TopupAwaitingPaymentImplCopyWith(
    _$TopupAwaitingPaymentImpl value,
    $Res Function(_$TopupAwaitingPaymentImpl) then,
  ) = __$$TopupAwaitingPaymentImplCopyWithImpl<$Res>;
  @useResult
  $Res call({
    String intentId,
    String destAddress,
    String? solanaPayUrl,
    String chain,
  });
}

/// @nodoc
class __$$TopupAwaitingPaymentImplCopyWithImpl<$Res>
    extends _$TopupStateCopyWithImpl<$Res, _$TopupAwaitingPaymentImpl>
    implements _$$TopupAwaitingPaymentImplCopyWith<$Res> {
  __$$TopupAwaitingPaymentImplCopyWithImpl(
    _$TopupAwaitingPaymentImpl _value,
    $Res Function(_$TopupAwaitingPaymentImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? intentId = null,
    Object? destAddress = null,
    Object? solanaPayUrl = freezed,
    Object? chain = null,
  }) {
    return _then(
      _$TopupAwaitingPaymentImpl(
        intentId: null == intentId
            ? _value.intentId
            : intentId // ignore: cast_nullable_to_non_nullable
                  as String,
        destAddress: null == destAddress
            ? _value.destAddress
            : destAddress // ignore: cast_nullable_to_non_nullable
                  as String,
        solanaPayUrl: freezed == solanaPayUrl
            ? _value.solanaPayUrl
            : solanaPayUrl // ignore: cast_nullable_to_non_nullable
                  as String?,
        chain: null == chain
            ? _value.chain
            : chain // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc

class _$TopupAwaitingPaymentImpl implements TopupAwaitingPayment {
  const _$TopupAwaitingPaymentImpl({
    required this.intentId,
    required this.destAddress,
    this.solanaPayUrl,
    required this.chain,
  });

  @override
  final String intentId;
  @override
  final String destAddress;
  @override
  final String? solanaPayUrl;
  @override
  final String chain;

  @override
  String toString() {
    return 'TopupState.awaitingPayment(intentId: $intentId, destAddress: $destAddress, solanaPayUrl: $solanaPayUrl, chain: $chain)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$TopupAwaitingPaymentImpl &&
            (identical(other.intentId, intentId) ||
                other.intentId == intentId) &&
            (identical(other.destAddress, destAddress) ||
                other.destAddress == destAddress) &&
            (identical(other.solanaPayUrl, solanaPayUrl) ||
                other.solanaPayUrl == solanaPayUrl) &&
            (identical(other.chain, chain) || other.chain == chain));
  }

  @override
  int get hashCode =>
      Object.hash(runtimeType, intentId, destAddress, solanaPayUrl, chain);

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$TopupAwaitingPaymentImplCopyWith<_$TopupAwaitingPaymentImpl>
  get copyWith =>
      __$$TopupAwaitingPaymentImplCopyWithImpl<_$TopupAwaitingPaymentImpl>(
        this,
        _$identity,
      );

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function() idle,
    required TResult Function() creatingIntent,
    required TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )
    awaitingPayment,
    required TResult Function(double newBalance) confirmed,
    required TResult Function(String message) error,
    required TResult Function() timedOut,
  }) {
    return awaitingPayment(intentId, destAddress, solanaPayUrl, chain);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function()? idle,
    TResult? Function()? creatingIntent,
    TResult? Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult? Function(double newBalance)? confirmed,
    TResult? Function(String message)? error,
    TResult? Function()? timedOut,
  }) {
    return awaitingPayment?.call(intentId, destAddress, solanaPayUrl, chain);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function()? idle,
    TResult Function()? creatingIntent,
    TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult Function(double newBalance)? confirmed,
    TResult Function(String message)? error,
    TResult Function()? timedOut,
    required TResult orElse(),
  }) {
    if (awaitingPayment != null) {
      return awaitingPayment(intentId, destAddress, solanaPayUrl, chain);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(TopupIdle value) idle,
    required TResult Function(TopupCreatingIntent value) creatingIntent,
    required TResult Function(TopupAwaitingPayment value) awaitingPayment,
    required TResult Function(TopupConfirmed value) confirmed,
    required TResult Function(TopupError value) error,
    required TResult Function(TopupTimedOut value) timedOut,
  }) {
    return awaitingPayment(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(TopupIdle value)? idle,
    TResult? Function(TopupCreatingIntent value)? creatingIntent,
    TResult? Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult? Function(TopupConfirmed value)? confirmed,
    TResult? Function(TopupError value)? error,
    TResult? Function(TopupTimedOut value)? timedOut,
  }) {
    return awaitingPayment?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(TopupIdle value)? idle,
    TResult Function(TopupCreatingIntent value)? creatingIntent,
    TResult Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult Function(TopupConfirmed value)? confirmed,
    TResult Function(TopupError value)? error,
    TResult Function(TopupTimedOut value)? timedOut,
    required TResult orElse(),
  }) {
    if (awaitingPayment != null) {
      return awaitingPayment(this);
    }
    return orElse();
  }
}

abstract class TopupAwaitingPayment implements TopupState {
  const factory TopupAwaitingPayment({
    required final String intentId,
    required final String destAddress,
    final String? solanaPayUrl,
    required final String chain,
  }) = _$TopupAwaitingPaymentImpl;

  String get intentId;
  String get destAddress;
  String? get solanaPayUrl;
  String get chain;

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$TopupAwaitingPaymentImplCopyWith<_$TopupAwaitingPaymentImpl>
  get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$TopupConfirmedImplCopyWith<$Res> {
  factory _$$TopupConfirmedImplCopyWith(
    _$TopupConfirmedImpl value,
    $Res Function(_$TopupConfirmedImpl) then,
  ) = __$$TopupConfirmedImplCopyWithImpl<$Res>;
  @useResult
  $Res call({double newBalance});
}

/// @nodoc
class __$$TopupConfirmedImplCopyWithImpl<$Res>
    extends _$TopupStateCopyWithImpl<$Res, _$TopupConfirmedImpl>
    implements _$$TopupConfirmedImplCopyWith<$Res> {
  __$$TopupConfirmedImplCopyWithImpl(
    _$TopupConfirmedImpl _value,
    $Res Function(_$TopupConfirmedImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? newBalance = null}) {
    return _then(
      _$TopupConfirmedImpl(
        newBalance: null == newBalance
            ? _value.newBalance
            : newBalance // ignore: cast_nullable_to_non_nullable
                  as double,
      ),
    );
  }
}

/// @nodoc

class _$TopupConfirmedImpl implements TopupConfirmed {
  const _$TopupConfirmedImpl({required this.newBalance});

  @override
  final double newBalance;

  @override
  String toString() {
    return 'TopupState.confirmed(newBalance: $newBalance)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$TopupConfirmedImpl &&
            (identical(other.newBalance, newBalance) ||
                other.newBalance == newBalance));
  }

  @override
  int get hashCode => Object.hash(runtimeType, newBalance);

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$TopupConfirmedImplCopyWith<_$TopupConfirmedImpl> get copyWith =>
      __$$TopupConfirmedImplCopyWithImpl<_$TopupConfirmedImpl>(
        this,
        _$identity,
      );

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function() idle,
    required TResult Function() creatingIntent,
    required TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )
    awaitingPayment,
    required TResult Function(double newBalance) confirmed,
    required TResult Function(String message) error,
    required TResult Function() timedOut,
  }) {
    return confirmed(newBalance);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function()? idle,
    TResult? Function()? creatingIntent,
    TResult? Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult? Function(double newBalance)? confirmed,
    TResult? Function(String message)? error,
    TResult? Function()? timedOut,
  }) {
    return confirmed?.call(newBalance);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function()? idle,
    TResult Function()? creatingIntent,
    TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult Function(double newBalance)? confirmed,
    TResult Function(String message)? error,
    TResult Function()? timedOut,
    required TResult orElse(),
  }) {
    if (confirmed != null) {
      return confirmed(newBalance);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(TopupIdle value) idle,
    required TResult Function(TopupCreatingIntent value) creatingIntent,
    required TResult Function(TopupAwaitingPayment value) awaitingPayment,
    required TResult Function(TopupConfirmed value) confirmed,
    required TResult Function(TopupError value) error,
    required TResult Function(TopupTimedOut value) timedOut,
  }) {
    return confirmed(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(TopupIdle value)? idle,
    TResult? Function(TopupCreatingIntent value)? creatingIntent,
    TResult? Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult? Function(TopupConfirmed value)? confirmed,
    TResult? Function(TopupError value)? error,
    TResult? Function(TopupTimedOut value)? timedOut,
  }) {
    return confirmed?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(TopupIdle value)? idle,
    TResult Function(TopupCreatingIntent value)? creatingIntent,
    TResult Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult Function(TopupConfirmed value)? confirmed,
    TResult Function(TopupError value)? error,
    TResult Function(TopupTimedOut value)? timedOut,
    required TResult orElse(),
  }) {
    if (confirmed != null) {
      return confirmed(this);
    }
    return orElse();
  }
}

abstract class TopupConfirmed implements TopupState {
  const factory TopupConfirmed({required final double newBalance}) =
      _$TopupConfirmedImpl;

  double get newBalance;

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$TopupConfirmedImplCopyWith<_$TopupConfirmedImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$TopupErrorImplCopyWith<$Res> {
  factory _$$TopupErrorImplCopyWith(
    _$TopupErrorImpl value,
    $Res Function(_$TopupErrorImpl) then,
  ) = __$$TopupErrorImplCopyWithImpl<$Res>;
  @useResult
  $Res call({String message});
}

/// @nodoc
class __$$TopupErrorImplCopyWithImpl<$Res>
    extends _$TopupStateCopyWithImpl<$Res, _$TopupErrorImpl>
    implements _$$TopupErrorImplCopyWith<$Res> {
  __$$TopupErrorImplCopyWithImpl(
    _$TopupErrorImpl _value,
    $Res Function(_$TopupErrorImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? message = null}) {
    return _then(
      _$TopupErrorImpl(
        message: null == message
            ? _value.message
            : message // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc

class _$TopupErrorImpl implements TopupError {
  const _$TopupErrorImpl({required this.message});

  @override
  final String message;

  @override
  String toString() {
    return 'TopupState.error(message: $message)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$TopupErrorImpl &&
            (identical(other.message, message) || other.message == message));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message);

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$TopupErrorImplCopyWith<_$TopupErrorImpl> get copyWith =>
      __$$TopupErrorImplCopyWithImpl<_$TopupErrorImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function() idle,
    required TResult Function() creatingIntent,
    required TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )
    awaitingPayment,
    required TResult Function(double newBalance) confirmed,
    required TResult Function(String message) error,
    required TResult Function() timedOut,
  }) {
    return error(message);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function()? idle,
    TResult? Function()? creatingIntent,
    TResult? Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult? Function(double newBalance)? confirmed,
    TResult? Function(String message)? error,
    TResult? Function()? timedOut,
  }) {
    return error?.call(message);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function()? idle,
    TResult Function()? creatingIntent,
    TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult Function(double newBalance)? confirmed,
    TResult Function(String message)? error,
    TResult Function()? timedOut,
    required TResult orElse(),
  }) {
    if (error != null) {
      return error(message);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(TopupIdle value) idle,
    required TResult Function(TopupCreatingIntent value) creatingIntent,
    required TResult Function(TopupAwaitingPayment value) awaitingPayment,
    required TResult Function(TopupConfirmed value) confirmed,
    required TResult Function(TopupError value) error,
    required TResult Function(TopupTimedOut value) timedOut,
  }) {
    return error(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(TopupIdle value)? idle,
    TResult? Function(TopupCreatingIntent value)? creatingIntent,
    TResult? Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult? Function(TopupConfirmed value)? confirmed,
    TResult? Function(TopupError value)? error,
    TResult? Function(TopupTimedOut value)? timedOut,
  }) {
    return error?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(TopupIdle value)? idle,
    TResult Function(TopupCreatingIntent value)? creatingIntent,
    TResult Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult Function(TopupConfirmed value)? confirmed,
    TResult Function(TopupError value)? error,
    TResult Function(TopupTimedOut value)? timedOut,
    required TResult orElse(),
  }) {
    if (error != null) {
      return error(this);
    }
    return orElse();
  }
}

abstract class TopupError implements TopupState {
  const factory TopupError({required final String message}) = _$TopupErrorImpl;

  String get message;

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$TopupErrorImplCopyWith<_$TopupErrorImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$TopupTimedOutImplCopyWith<$Res> {
  factory _$$TopupTimedOutImplCopyWith(
    _$TopupTimedOutImpl value,
    $Res Function(_$TopupTimedOutImpl) then,
  ) = __$$TopupTimedOutImplCopyWithImpl<$Res>;
}

/// @nodoc
class __$$TopupTimedOutImplCopyWithImpl<$Res>
    extends _$TopupStateCopyWithImpl<$Res, _$TopupTimedOutImpl>
    implements _$$TopupTimedOutImplCopyWith<$Res> {
  __$$TopupTimedOutImplCopyWithImpl(
    _$TopupTimedOutImpl _value,
    $Res Function(_$TopupTimedOutImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of TopupState
  /// with the given fields replaced by the non-null parameter values.
}

/// @nodoc

class _$TopupTimedOutImpl implements TopupTimedOut {
  const _$TopupTimedOutImpl();

  @override
  String toString() {
    return 'TopupState.timedOut()';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is _$TopupTimedOutImpl);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function() idle,
    required TResult Function() creatingIntent,
    required TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )
    awaitingPayment,
    required TResult Function(double newBalance) confirmed,
    required TResult Function(String message) error,
    required TResult Function() timedOut,
  }) {
    return timedOut();
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function()? idle,
    TResult? Function()? creatingIntent,
    TResult? Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult? Function(double newBalance)? confirmed,
    TResult? Function(String message)? error,
    TResult? Function()? timedOut,
  }) {
    return timedOut?.call();
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function()? idle,
    TResult Function()? creatingIntent,
    TResult Function(
      String intentId,
      String destAddress,
      String? solanaPayUrl,
      String chain,
    )?
    awaitingPayment,
    TResult Function(double newBalance)? confirmed,
    TResult Function(String message)? error,
    TResult Function()? timedOut,
    required TResult orElse(),
  }) {
    if (timedOut != null) {
      return timedOut();
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(TopupIdle value) idle,
    required TResult Function(TopupCreatingIntent value) creatingIntent,
    required TResult Function(TopupAwaitingPayment value) awaitingPayment,
    required TResult Function(TopupConfirmed value) confirmed,
    required TResult Function(TopupError value) error,
    required TResult Function(TopupTimedOut value) timedOut,
  }) {
    return timedOut(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(TopupIdle value)? idle,
    TResult? Function(TopupCreatingIntent value)? creatingIntent,
    TResult? Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult? Function(TopupConfirmed value)? confirmed,
    TResult? Function(TopupError value)? error,
    TResult? Function(TopupTimedOut value)? timedOut,
  }) {
    return timedOut?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(TopupIdle value)? idle,
    TResult Function(TopupCreatingIntent value)? creatingIntent,
    TResult Function(TopupAwaitingPayment value)? awaitingPayment,
    TResult Function(TopupConfirmed value)? confirmed,
    TResult Function(TopupError value)? error,
    TResult Function(TopupTimedOut value)? timedOut,
    required TResult orElse(),
  }) {
    if (timedOut != null) {
      return timedOut(this);
    }
    return orElse();
  }
}

abstract class TopupTimedOut implements TopupState {
  const factory TopupTimedOut() = _$TopupTimedOutImpl;
}
