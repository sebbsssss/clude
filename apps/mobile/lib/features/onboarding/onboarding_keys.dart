import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class OnboardingKeys {
  final modelChip = GlobalKey(debugLabel: 'onboarding_model_chip');
  final balanceChip = GlobalKey(debugLabel: 'onboarding_balance_chip');
  final chatInput = GlobalKey(debugLabel: 'onboarding_chat_input');
  final greeting = GlobalKey(debugLabel: 'onboarding_greeting');
  final messageBubble = GlobalKey(debugLabel: 'onboarding_message_bubble');
  final fab = GlobalKey(debugLabel: 'onboarding_fab');

  GlobalKey? keyForStep(int step) => switch (step) {
        0 => greeting,
        1 => modelChip,
        2 => fab,
        3 => balanceChip,
        _ => null,
      };
}

final onboardingKeysProvider = Provider<OnboardingKeys>((_) => OnboardingKeys());
