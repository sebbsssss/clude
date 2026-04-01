// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'auth_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

/// @nodoc
mixin _$AuthState {
  bool get isAuthenticated => throw _privateConstructorUsedError;
  bool get isGuest => throw _privateConstructorUsedError;
  String? get cortexKey => throw _privateConstructorUsedError;
  String? get walletAddress => throw _privateConstructorUsedError;
  AuthMode? get authMode => throw _privateConstructorUsedError;
  bool get isLoading => throw _privateConstructorUsedError;
  String? get error => throw _privateConstructorUsedError;

  /// Create a copy of AuthState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $AuthStateCopyWith<AuthState> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $AuthStateCopyWith<$Res> {
  factory $AuthStateCopyWith(AuthState value, $Res Function(AuthState) then) =
      _$AuthStateCopyWithImpl<$Res, AuthState>;
  @useResult
  $Res call({
    bool isAuthenticated,
    bool isGuest,
    String? cortexKey,
    String? walletAddress,
    AuthMode? authMode,
    bool isLoading,
    String? error,
  });
}

/// @nodoc
class _$AuthStateCopyWithImpl<$Res, $Val extends AuthState>
    implements $AuthStateCopyWith<$Res> {
  _$AuthStateCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of AuthState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? isAuthenticated = null,
    Object? isGuest = null,
    Object? cortexKey = freezed,
    Object? walletAddress = freezed,
    Object? authMode = freezed,
    Object? isLoading = null,
    Object? error = freezed,
  }) {
    return _then(
      _value.copyWith(
            isAuthenticated: null == isAuthenticated
                ? _value.isAuthenticated
                : isAuthenticated // ignore: cast_nullable_to_non_nullable
                      as bool,
            isGuest: null == isGuest
                ? _value.isGuest
                : isGuest // ignore: cast_nullable_to_non_nullable
                      as bool,
            cortexKey: freezed == cortexKey
                ? _value.cortexKey
                : cortexKey // ignore: cast_nullable_to_non_nullable
                      as String?,
            walletAddress: freezed == walletAddress
                ? _value.walletAddress
                : walletAddress // ignore: cast_nullable_to_non_nullable
                      as String?,
            authMode: freezed == authMode
                ? _value.authMode
                : authMode // ignore: cast_nullable_to_non_nullable
                      as AuthMode?,
            isLoading: null == isLoading
                ? _value.isLoading
                : isLoading // ignore: cast_nullable_to_non_nullable
                      as bool,
            error: freezed == error
                ? _value.error
                : error // ignore: cast_nullable_to_non_nullable
                      as String?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$AuthStateImplCopyWith<$Res>
    implements $AuthStateCopyWith<$Res> {
  factory _$$AuthStateImplCopyWith(
    _$AuthStateImpl value,
    $Res Function(_$AuthStateImpl) then,
  ) = __$$AuthStateImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    bool isAuthenticated,
    bool isGuest,
    String? cortexKey,
    String? walletAddress,
    AuthMode? authMode,
    bool isLoading,
    String? error,
  });
}

/// @nodoc
class __$$AuthStateImplCopyWithImpl<$Res>
    extends _$AuthStateCopyWithImpl<$Res, _$AuthStateImpl>
    implements _$$AuthStateImplCopyWith<$Res> {
  __$$AuthStateImplCopyWithImpl(
    _$AuthStateImpl _value,
    $Res Function(_$AuthStateImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of AuthState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? isAuthenticated = null,
    Object? isGuest = null,
    Object? cortexKey = freezed,
    Object? walletAddress = freezed,
    Object? authMode = freezed,
    Object? isLoading = null,
    Object? error = freezed,
  }) {
    return _then(
      _$AuthStateImpl(
        isAuthenticated: null == isAuthenticated
            ? _value.isAuthenticated
            : isAuthenticated // ignore: cast_nullable_to_non_nullable
                  as bool,
        isGuest: null == isGuest
            ? _value.isGuest
            : isGuest // ignore: cast_nullable_to_non_nullable
                  as bool,
        cortexKey: freezed == cortexKey
            ? _value.cortexKey
            : cortexKey // ignore: cast_nullable_to_non_nullable
                  as String?,
        walletAddress: freezed == walletAddress
            ? _value.walletAddress
            : walletAddress // ignore: cast_nullable_to_non_nullable
                  as String?,
        authMode: freezed == authMode
            ? _value.authMode
            : authMode // ignore: cast_nullable_to_non_nullable
                  as AuthMode?,
        isLoading: null == isLoading
            ? _value.isLoading
            : isLoading // ignore: cast_nullable_to_non_nullable
                  as bool,
        error: freezed == error
            ? _value.error
            : error // ignore: cast_nullable_to_non_nullable
                  as String?,
      ),
    );
  }
}

/// @nodoc

class _$AuthStateImpl implements _AuthState {
  const _$AuthStateImpl({
    this.isAuthenticated = false,
    this.isGuest = false,
    this.cortexKey,
    this.walletAddress,
    this.authMode,
    this.isLoading = false,
    this.error,
  });

  @override
  @JsonKey()
  final bool isAuthenticated;
  @override
  @JsonKey()
  final bool isGuest;
  @override
  final String? cortexKey;
  @override
  final String? walletAddress;
  @override
  final AuthMode? authMode;
  @override
  @JsonKey()
  final bool isLoading;
  @override
  final String? error;

  @override
  String toString() {
    return 'AuthState(isAuthenticated: $isAuthenticated, isGuest: $isGuest, cortexKey: $cortexKey, walletAddress: $walletAddress, authMode: $authMode, isLoading: $isLoading, error: $error)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$AuthStateImpl &&
            (identical(other.isAuthenticated, isAuthenticated) ||
                other.isAuthenticated == isAuthenticated) &&
            (identical(other.isGuest, isGuest) || other.isGuest == isGuest) &&
            (identical(other.cortexKey, cortexKey) ||
                other.cortexKey == cortexKey) &&
            (identical(other.walletAddress, walletAddress) ||
                other.walletAddress == walletAddress) &&
            (identical(other.authMode, authMode) ||
                other.authMode == authMode) &&
            (identical(other.isLoading, isLoading) ||
                other.isLoading == isLoading) &&
            (identical(other.error, error) || other.error == error));
  }

  @override
  int get hashCode => Object.hash(
    runtimeType,
    isAuthenticated,
    isGuest,
    cortexKey,
    walletAddress,
    authMode,
    isLoading,
    error,
  );

  /// Create a copy of AuthState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$AuthStateImplCopyWith<_$AuthStateImpl> get copyWith =>
      __$$AuthStateImplCopyWithImpl<_$AuthStateImpl>(this, _$identity);
}

abstract class _AuthState implements AuthState {
  const factory _AuthState({
    final bool isAuthenticated,
    final bool isGuest,
    final String? cortexKey,
    final String? walletAddress,
    final AuthMode? authMode,
    final bool isLoading,
    final String? error,
  }) = _$AuthStateImpl;

  @override
  bool get isAuthenticated;
  @override
  bool get isGuest;
  @override
  String? get cortexKey;
  @override
  String? get walletAddress;
  @override
  AuthMode? get authMode;
  @override
  bool get isLoading;
  @override
  String? get error;

  /// Create a copy of AuthState
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$AuthStateImplCopyWith<_$AuthStateImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
