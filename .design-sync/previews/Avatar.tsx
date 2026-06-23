import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "outvers-next";

export function Fallback() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Avatar size="sm">
        <AvatarFallback>AC</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>TN</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>RS</AvatarFallback>
      </Avatar>
    </div>
  );
}

export function WithImage() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Avatar size="lg">
        <AvatarImage src="https://i.pravatar.cc/96?img=12" alt="Guide Tenzin" />
        <AvatarFallback>TN</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarImage src="https://i.pravatar.cc/96?img=32" alt="Guide Aarav" />
        <AvatarFallback>AC</AvatarFallback>
      </Avatar>
    </div>
  );
}

export function Group() {
  return (
    <AvatarGroup>
      <Avatar>
        <AvatarImage src="https://i.pravatar.cc/96?img=5" alt="" />
        <AvatarFallback>RS</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarImage src="https://i.pravatar.cc/96?img=14" alt="" />
        <AvatarFallback>AC</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarImage src="https://i.pravatar.cc/96?img=23" alt="" />
        <AvatarFallback>TN</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+5</AvatarGroupCount>
    </AvatarGroup>
  );
}
