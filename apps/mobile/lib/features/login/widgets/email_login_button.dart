import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_provider.dart';

/// Button that initiates the Privy email OTP login flow.
///
/// Tapping it opens a bottom sheet where the user enters their email,
/// receives a one-time code, and completes authentication.
class EmailLoginButton extends ConsumerWidget {
  const EmailLoginButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authNotifierProvider);

    return SizedBox(
      height: 48,
      child: OutlinedButton.icon(
        onPressed: authState.isLoading
            ? null
            : () => _showEmailSheet(context, ref),
        style: OutlinedButton.styleFrom(
          side: BorderSide(
            color: Theme.of(context).colorScheme.outline,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
        icon: const Icon(Icons.email_outlined, size: 20),
        label: const Text('Sign in with Email'),
      ),
    );
  }

  Future<void> _showEmailSheet(BuildContext context, WidgetRef ref) async {
    final success = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => _EmailOtpSheet(ref: ref),
    );
    if (success == true && context.mounted) {
      context.go('/chat');
    }
  }
}

/// Bottom sheet that manages the two-step email OTP flow:
/// 1. User enters email → tap "Send code"
/// 2. User enters OTP  → tap "Verify"
class _EmailOtpSheet extends ConsumerStatefulWidget {
  const _EmailOtpSheet({required this.ref});

  /// Parent ref passed in so mutations flow to the same container.
  final WidgetRef ref;

  @override
  ConsumerState<_EmailOtpSheet> createState() => _EmailOtpSheetState();
}

class _EmailOtpSheetState extends ConsumerState<_EmailOtpSheet> {
  final _emailController = TextEditingController();
  final _codeController = TextEditingController();

  bool _codeSent = false;

  @override
  void dispose() {
    _emailController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    final email = _emailController.text.trim();
    if (email.isEmpty) return;

    final sent = await widget.ref
        .read(authNotifierProvider.notifier)
        .sendEmailCode(email);

    if (sent && mounted) {
      setState(() => _codeSent = true);
    }
  }

  Future<void> _verify() async {
    final email = _emailController.text.trim();
    final code = _codeController.text.trim();
    if (email.isEmpty || code.isEmpty) return;

    final success = await widget.ref
        .read(authNotifierProvider.notifier)
        .loginWithEmailCode(email: email, code: code);

    if (mounted) {
      Navigator.of(context).pop(success);
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = widget.ref.watch(authNotifierProvider);
    final isLoading = authState.isLoading;
    final error = authState.error;

    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _codeSent ? 'Enter your code' : 'Sign in with Email',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          Text(
            _codeSent
                ? 'We sent a code to ${_emailController.text.trim()}.'
                : 'We\'ll send a one-time code to your email.',
            style: TextStyle(
              color: Theme.of(context)
                  .colorScheme
                  .onSurface
                  .withValues(alpha: 0.6),
            ),
          ),
          const SizedBox(height: 24),
          TextField(
            controller: _emailController,
            enabled: !_codeSent && !isLoading,
            keyboardType: TextInputType.emailAddress,
            textInputAction:
                _codeSent ? TextInputAction.next : TextInputAction.done,
            autofillHints: const [AutofillHints.email],
            decoration: const InputDecoration(
              labelText: 'Email address',
              border: OutlineInputBorder(),
            ),
            onSubmitted: _codeSent ? null : (_) => _sendCode(),
          ),
          if (_codeSent) ...[
            const SizedBox(height: 16),
            TextField(
              controller: _codeController,
              enabled: !isLoading,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.done,
              autofillHints: const [AutofillHints.oneTimeCode],
              decoration: const InputDecoration(
                labelText: 'One-time code',
                border: OutlineInputBorder(),
              ),
              onSubmitted: (_) => _verify(),
            ),
          ],
          if (error != null) ...[
            const SizedBox(height: 12),
            Text(
              error,
              style: TextStyle(
                color: Theme.of(context).colorScheme.error,
                fontSize: 13,
              ),
            ),
          ],
          const SizedBox(height: 24),
          SizedBox(
            height: 48,
            child: ElevatedButton(
              onPressed: isLoading
                  ? null
                  : (_codeSent ? _verify : _sendCode),
              child: isLoading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(_codeSent ? 'Verify' : 'Send code'),
            ),
          ),
          if (_codeSent) ...[
            const SizedBox(height: 12),
            TextButton(
              onPressed: isLoading
                  ? null
                  : () => setState(() {
                        _codeSent = false;
                        _codeController.clear();
                      }),
              child: const Text('Use a different email'),
            ),
          ],
        ],
      ),
    );
  }
}
